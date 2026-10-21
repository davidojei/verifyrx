-- Phase 2, free-first pack check.
-- Compares the details a user types from a pack with our records. No AI, no paid service.
-- Returns "signs" for the app's combiner (packages/decision/src/photo.ts).

insert into feature_flags (flag, country, enabled) values ('pack_check', '*', false)
on conflict (flag, country) do nothing;

-- Private helpers (the apps cannot call these).
create function public._norm(p text) returns text
language sql immutable
as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create function public._name_tokens(p text) returns text[]
language sql immutable
as $$
  select coalesce(array_agg(distinct t), '{}'::text[])
  from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9]+', ' ', 'g')), '\s+')) as t
  where length(t) >= 3
    and t !~ '^[0-9]+$'
    and t <> all (array['tablet','tablets','capsule','capsules','syrup','suspension','injection',
                        'film','coated','oral','the','and','demo','pack'])
$$;

create function public._add_sign(p_signs jsonb, p_code text, p_field text) returns jsonb
language sql immutable
as $$
  select case
    when p_signs @> jsonb_build_array(jsonb_build_object('code', p_code, 'field', p_field)) then p_signs
    else p_signs || jsonb_build_array(jsonb_build_object('code', p_code, 'field', p_field))
  end
$$;

create function public._pack_text(p jsonb, k text, maxlen int) returns text
language plpgsql immutable
as $$
declare v jsonb := p -> k; t text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'string' then raise exception 'invalid_input'; end if;
  t := nullif(btrim(v #>> '{}'), '');
  if t is not null and length(t) > maxlen then raise exception 'invalid_input'; end if;
  return t;
end $$;

revoke execute on function public._norm(text) from public, anon, authenticated;
revoke execute on function public._name_tokens(text) from public, anon, authenticated;
revoke execute on function public._add_sign(jsonb, text, text) from public, anon, authenticated;
revoke execute on function public._pack_text(jsonb, text, int) from public, anon, authenticated;

-- p_fields keys (all optional): nafdac_reg_no, product_name, batch_no, expiry_ym, mfg_ym ('YYYY-MM'),
-- missing (array of: nafdac_reg_no, batch_no, expiry_date = "not printed on the pack").
create function public.crosscheck_pack(p_fields jsonb, p_code text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  c_required constant text[] := array['nafdac_reg_no', 'batch_no', 'expiry_date'];
  v_uid uuid := auth.uid();
  v_started timestamptz := clock_timestamp();
  v_day date := (now() at time zone 'Africa/Lagos')::date;
  v_today_ym text := to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM');
  v_reg text; v_name text; v_batch text; v_exp text; v_mfg text;
  v_missing text[] := '{}';
  m jsonb;
  v_code text := nullif(btrim(p_code), '');
  v_signs jsonb := '[]'::jsonb;
  v_checked text[] := '{}';
  v_prod products%rowtype; v_prod_found boolean := false;
  v_b batches%rowtype; v_b_found boolean := false;
  v_cp products%rowtype; v_cb batches%rowtype; v_code_found boolean := false;
  v_usable boolean;
  v_state text;
  v_calls int;
  v_id uuid := gen_random_uuid();
  v_ms int;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  if not public.flag_on('pack_check') then raise exception 'feature_off'; end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception 'invalid_input'; end if;
  if v_code is not null and length(v_code) > 256 then raise exception 'invalid_input'; end if;

  v_reg   := public._pack_text(p_fields, 'nafdac_reg_no', 50);
  v_name  := public._pack_text(p_fields, 'product_name', 200);
  v_batch := public._pack_text(p_fields, 'batch_no', 40);
  v_exp   := public._pack_text(p_fields, 'expiry_ym', 7);
  v_mfg   := public._pack_text(p_fields, 'mfg_ym', 7);
  if v_exp is not null and v_exp !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_input'; end if;
  if v_mfg is not null and v_mfg !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_input'; end if;

  if p_fields ? 'missing' then
    if jsonb_typeof(p_fields -> 'missing') <> 'array' or jsonb_array_length(p_fields -> 'missing') > 3 then
      raise exception 'invalid_input';
    end if;
    for m in select * from jsonb_array_elements(p_fields -> 'missing') loop
      if jsonb_typeof(m) <> 'string' or not ((m #>> '{}') = any (c_required)) then
        raise exception 'invalid_input';
      end if;
      v_missing := array_append(v_missing, m #>> '{}');
    end loop;
  end if;

  -- Limits: per phone per day, and a global kill switch. Refused requests are not counted.
  insert into analysis_usage (subject, day, calls) values ('u:' || v_uid::text, v_day, 1)
  on conflict (subject, day) do update set calls = analysis_usage.calls + 1
  returning calls into v_calls;
  if v_calls > public.cfg('max_analyses_per_day') then raise exception 'rate_limited'; end if;

  insert into analysis_usage (subject, day, calls) values ('global', v_day, 1)
  on conflict (subject, day) do update set calls = analysis_usage.calls + 1
  returning calls into v_calls;
  if v_calls > public.cfg('max_global_analyses_per_day') then raise exception 'rate_limited'; end if;

  -- Required details declared as "not printed on the pack".
  if (v_reg is not null or 'nafdac_reg_no' = any (v_missing))
     and (v_batch is not null or 'batch_no' = any (v_missing))
     and (v_exp is not null or 'expiry_date' = any (v_missing)) then
    v_checked := array_append(v_checked, 'required');
  end if;
  if v_reg is null and 'nafdac_reg_no' = any (v_missing) then
    v_signs := public._add_sign(v_signs, 'MANDATORY_FIELD_MISSING', 'nafdac_reg_no');
  end if;
  if v_batch is null and 'batch_no' = any (v_missing) then
    v_signs := public._add_sign(v_signs, 'MANDATORY_FIELD_MISSING', 'batch_no');
  end if;
  if v_exp is null and 'expiry_date' = any (v_missing) then
    v_signs := public._add_sign(v_signs, 'MANDATORY_FIELD_MISSING', 'expiry_date');
  end if;

  -- Expiry: valid through the end of the printed month.
  if v_exp is not null then
    v_checked := array_append(v_checked, 'expiry');
    if v_exp < v_today_ym then
      v_signs := public._add_sign(v_signs, 'PACK_EXPIRED', 'expiry_date');
    end if;
  end if;

  -- The typed registration number, looked up in our records.
  if v_reg is not null then
    select * into v_prod from products where public._norm(nafdac_reg_no) = public._norm(v_reg) limit 1;
    v_prod_found := found;
  end if;

  if v_prod_found then
    v_checked := array_append(v_checked, 'registration');

    if v_name is not null and cardinality(public._name_tokens(v_name)) > 0 then
      v_checked := array_append(v_checked, 'name');
      if not (public._name_tokens(v_name) && public._name_tokens(v_prod.name)) then
        v_signs := public._add_sign(v_signs, 'REG_NO_MISMATCH', 'nafdac_reg_no');
      end if;
    end if;

    if v_batch is not null and v_prod.batch_pattern is not null then
      begin
        if v_batch !~* v_prod.batch_pattern then
          v_signs := public._add_sign(v_signs, 'BATCH_FORMAT_MISMATCH', 'batch_no');
        end if;
        v_checked := array_append(v_checked, 'batch_format');
      exception when others then
        null; -- an unusable pattern is skipped quietly
      end;
    end if;

    if v_batch is not null then
      select * into v_b from batches
       where product_id = v_prod.id and public._norm(batch_no) = public._norm(v_batch) limit 1;
      v_b_found := found;
      if v_b_found then
        v_checked := array_append(v_checked, 'batch_record');
        if v_exp is not null and to_char(v_b.expiry_date, 'YYYY-MM') <> v_exp then
          v_signs := public._add_sign(v_signs, 'PACK_CONTRADICTS_RECORD', 'expiry_date');
        end if;
        if v_mfg is not null and v_b.mfg_date is not null and to_char(v_b.mfg_date, 'YYYY-MM') <> v_mfg then
          v_signs := public._add_sign(v_signs, 'PACK_CONTRADICTS_RECORD', 'mfg_date');
        end if;
      end if;
    end if;
  end if;

  -- The code the user scanned, if any: the strongest comparison.
  if v_code is not null then
    select * into v_cb from batches where id = (select batch_id from codes where code_value = v_code);
    v_code_found := found;
    if v_code_found then
      select * into v_cp from products where id = v_cb.product_id;
      v_checked := array_append(v_checked, 'code_record');
      if v_reg is not null and public._norm(v_reg) <> public._norm(v_cp.nafdac_reg_no) then
        v_signs := public._add_sign(v_signs,
          case when v_prod_found then 'REG_NO_MISMATCH' else 'PACK_CONTRADICTS_RECORD' end, 'nafdac_reg_no');
      end if;
      if v_batch is not null and public._norm(v_batch) <> public._norm(v_cb.batch_no) then
        v_signs := public._add_sign(v_signs, 'PACK_CONTRADICTS_RECORD', 'batch_no');
      end if;
      if v_exp is not null and to_char(v_cb.expiry_date, 'YYYY-MM') <> v_exp then
        v_signs := public._add_sign(v_signs, 'PACK_CONTRADICTS_RECORD', 'expiry_date');
      end if;
      if v_mfg is not null and v_cb.mfg_date is not null and to_char(v_cb.mfg_date, 'YYYY-MM') <> v_mfg then
        v_signs := public._add_sign(v_signs, 'PACK_CONTRADICTS_RECORD', 'mfg_date');
      end if;
    end if;
  end if;

  -- Product to echo back and take tips from: the typed registration number, else the scanned code.
  if not v_prod_found and v_code_found then
    v_prod := v_cp;
    v_prod_found := true;
  end if;

  v_usable := v_prod_found or jsonb_array_length(v_signs) > 0;
  v_state := case
    when jsonb_array_length(v_signs) > 0 then 'SIGNS_FOUND'
    when v_usable then 'NO_SIGNS'
    else 'INCONCLUSIVE'
  end;
  v_ms := (extract(epoch from clock_timestamp() - v_started) * 1000)::int;

  insert into analyses (id, user_id, kind, input_hash, code_value, photo_state, signs, extraction,
                        model, prompt_version, latency_ms, est_cost_usd)
  values (v_id, v_uid, 'pack',
          encode(sha256(convert_to(p_fields::text || '|' || coalesce(v_code, ''), 'UTF8')), 'hex'),
          v_code, v_state, v_signs,
          jsonb_build_object('entered', p_fields, 'checked', to_jsonb(v_checked)),
          'typed-entry', 'crosscheck@1', v_ms, 0);

  return jsonb_build_object(
    'analysis_id', v_id,
    'usable', v_usable,
    'confidence', 0.9,
    'signs', v_signs,
    'checked', to_jsonb(v_checked),
    'product', case when v_prod_found
                    then jsonb_build_object('name', v_prod.name, 'manufacturer', v_prod.manufacturer) end,
    'tips', case when v_prod_found then v_prod.known_fake_signs end
  );
end $$;

revoke execute on function public.crosscheck_pack(jsonb, text) from public, anon;
grant execute on function public.crosscheck_pack(jsonb, text) to authenticated;