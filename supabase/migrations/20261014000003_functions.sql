-- The decision rules and the two functions the apps call. Run third.

-- The rules, in one place. verify_code calls this; so does the parity test.
create function public.decide_reasons(
  p_found boolean, p_batch_status text, p_expiry date, p_today date,
  p_scan_count int, p_devices int, p_areas int, p_fake int, p_open_reports int,
  p_at_devices numeric, p_at_areas numeric, p_at_scans numeric, p_at_reports numeric
) returns text[]
language plpgsql immutable
as $$
declare v text[] := '{}';
begin
  if not p_found then return array['CODE_NOT_FOUND']; end if;
  if p_batch_status = 'recalled' then v := array_append(v, 'RECALLED'); end if;
  if p_expiry < p_today then v := array_append(v, 'EXPIRED'); end if;
  if p_fake > 0 then v := array_append(v, 'REPORTED_FAKE'); end if;
  if p_open_reports >= p_at_reports then v := array_append(v, 'REPORTED_BY_USERS'); end if;
  if p_devices >= p_at_devices then v := array_append(v, 'MANY_DEVICES'); end if;
  if p_areas >= p_at_areas then v := array_append(v, 'MANY_LOCATIONS'); end if;
  if p_scan_count >= p_at_scans then v := array_append(v, 'HIGH_SCAN_COUNT'); end if;
  return v;
end $$;

revoke execute on function public.decide_reasons(
  boolean, text, date, date, int, int, int, int, int, numeric, numeric, numeric, numeric
) from public, anon, authenticated;

create function public.verify_code(
  p_code text, p_lat numeric default null, p_lng numeric default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := btrim(p_code);
  v_lat numeric; v_lng numeric;
  v_c codes%rowtype; v_b batches%rowtype; v_p products%rowtype;
  v_scan_id uuid; v_scan_count int; v_repeat boolean;
  v_devices int; v_areas int; v_fake int; v_user_reports int;
  v_cell numeric := public.cfg('area_cell_km');
  v_window numeric := coalesce(public.cfg('rescan_window_hours'), 0);
  v_reasons text[];
  v_state text;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  if v_code is null or length(v_code) not between 1 and 256 then
    raise exception 'invalid_code';
  end if;

  -- Anti-enumeration: cap lookups per user per minute.
  if (select count(*) from scans
       where user_id = v_uid and created_at > now() - interval '1 minute')
     >= public.cfg('max_scans_per_minute') then
    raise exception 'rate_limited';
  end if;

  if p_lat between -90 and 90 and p_lng between -180 and 180 then
    v_lat := round(p_lat, 2); v_lng := round(p_lng, 2);
  end if;

  -- Row lock serialises concurrent scans of the same code.
  select * into v_c from codes where code_value = v_code for update;

  if not found then
    insert into scans (code_value, result, user_id, lat, lng)
    values (v_code, 'CANT_CONFIRM', v_uid, v_lat, v_lng);
    return jsonb_build_object('state', 'CANT_CONFIRM',
                              'reasons', jsonb_build_array('CODE_NOT_FOUND'));
  end if;

  -- The same phone re-checking the same code within the window is not a new scan.
  v_repeat := v_window > 0 and exists (
    select 1 from scans
     where code_value = v_code and user_id = v_uid
       and created_at > now() - (v_window::double precision * interval '1 hour'));

  update codes
     set scan_count = scan_count + case when v_repeat then 0 else 1 end,
         first_scanned_at = coalesce(first_scanned_at, now())
   where id = v_c.id
   returning scan_count into v_scan_count;

  insert into scans (code_value, result, user_id, lat, lng)
  values (v_code, 'VERIFIED', v_uid, v_lat, v_lng)
  returning id into v_scan_id;

  select * into v_b from batches  where id = v_c.batch_id;
  select * into v_p from products where id = v_b.product_id;

  select count(distinct user_id),
         count(distinct (floor(lat * 111 / v_cell)::text || ':' || floor(lng * 111 / v_cell)::text))
           filter (where lat is not null and lng is not null)
    into v_devices, v_areas
    from scans where code_value = v_code;

  select count(*) filter (where status = 'confirmed_fake'),
         count(distinct reporter_id) filter (where status = 'new' and reporter_id is not null)
    into v_fake, v_user_reports
    from reports where code_value = v_code;

  v_reasons := public.decide_reasons(
    true, v_b.status, v_b.expiry_date, (now() at time zone 'Africa/Lagos')::date,
    v_scan_count, v_devices, v_areas, v_fake, v_user_reports,
    public.cfg('flag_at_devices'), public.cfg('flag_at_areas'),
    public.cfg('flag_at_scans'), public.cfg('flag_at_reports'));

  v_state := case when cardinality(v_reasons) > 0 then 'SUSPICIOUS' else 'VERIFIED' end;
  update scans set result = v_state where id = v_scan_id;

  return jsonb_build_object(
    'state', v_state,
    'reasons', to_jsonb(v_reasons),
    'product', jsonb_build_object(
       'name', v_p.name, 'manufacturer', v_p.manufacturer,
       'nafdac_reg_no', v_p.nafdac_reg_no,
       'active_ingredient', v_p.active_ingredient, 'strength', v_p.strength),
    'batch', jsonb_build_object(
       'batch_no', v_b.batch_no, 'mfg_date', v_b.mfg_date,
       'expiry_date', v_b.expiry_date, 'status', v_b.status),
    'stats', jsonb_build_object(
       'scan_count', v_scan_count, 'distinct_devices', v_devices, 'distinct_areas', v_areas)
  );
end $$;

-- Offline data for the phone: salted hashes of codes (not the codes), plus the thresholds.
-- Capped at 2000 codes for this MVP (see README, Known limitations).
create function public.sync_bundle() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_salt text;
  v_cell numeric := public.cfg('area_cell_km');
  v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select value into v_salt from app_secrets where key = 'code_hash_salt';

  select coalesce(jsonb_agg(jsonb_build_object(
      'h', encode(sha256(convert_to(v_salt || ':' || c.code_value, 'UTF8')), 'hex'),
      'product_name', p.name,
      'manufacturer', p.manufacturer,
      'nafdac_reg_no', p.nafdac_reg_no,
      'active_ingredient', p.active_ingredient,
      'strength', p.strength,
      'batch_no', b.batch_no,
      'mfg_date', b.mfg_date,
      'expiry_date', b.expiry_date,
      'batch_status', b.status,
      'scan_count', c.scan_count,
      'distinct_devices', coalesce(st.devices, 0),
      'distinct_areas', coalesce(st.areas, 0),
      'confirmed_fake_reports', coalesce(rp.fake, 0),
      'open_user_reports', coalesce(rp.open_reports, 0)
    )), '[]'::jsonb)
  into v_rows
  from (select * from codes order by id limit 2000) c
  join batches b on b.id = c.batch_id
  join products p on p.id = b.product_id
  left join lateral (
    select count(distinct s.user_id) as devices,
           count(distinct (floor(s.lat * 111 / v_cell)::text || ':' || floor(s.lng * 111 / v_cell)::text))
             filter (where s.lat is not null and s.lng is not null) as areas
    from scans s where s.code_value = c.code_value
  ) st on true
  left join lateral (
    select count(*) filter (where r.status = 'confirmed_fake') as fake,
           count(distinct r.reporter_id) filter (where r.status = 'new' and r.reporter_id is not null) as open_reports
    from reports r where r.code_value = c.code_value
  ) rp on true;

  return jsonb_build_object(
    'synced_at', now(),
    'salt', v_salt,
    'config', jsonb_build_object(
      'flag_at_devices', public.cfg('flag_at_devices'),
      'flag_at_areas', public.cfg('flag_at_areas'),
      'flag_at_scans', public.cfg('flag_at_scans'),
      'flag_at_reports', public.cfg('flag_at_reports')),
    'rows', v_rows);
end $$;

revoke execute on function public.verify_code(text, numeric, numeric) from public, anon;
grant  execute on function public.verify_code(text, numeric, numeric) to authenticated;
revoke execute on function public.sync_bundle() from public, anon;
grant  execute on function public.sync_bundle() to authenticated;