-- Pack check tests. Needs the demo seed data. Everything is rolled back at the end.
begin;

update products
   set batch_pattern = '^PCM-[0-9]{4}$',
       known_fake_signs = 'Check that the seal and hologram are intact.'
 where nafdac_reg_no = 'DEMO-A4-0001';
update app_config set value = 1000 where key in ('max_analyses_per_day', 'max_global_analyses_per_day');

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","is_anonymous":true}', true);
end $$;

-- 1. Switched off by default
do $$
begin
  begin
    perform public.crosscheck_pack('{"nafdac_reg_no":"DEMO-A4-0001"}');
    raise exception 'the check ran while its flag was off';
  exception when others then
    assert sqlerrm = 'feature_off', 'unexpected: ' || sqlerrm;
  end;
end $$;

reset role;
update feature_flags set enabled = true where flag = 'pack_check' and country = '*';
set local role authenticated;

-- 2. The checks
do $$
declare
  r jsonb;
  t text;
  ym text := to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM');
begin
  -- A clean pack
  r := public.crosscheck_pack('{"nafdac_reg_no":"DEMO-A4-0001","product_name":"Paracetamol 500 mg tablets","batch_no":"PCM-2501","expiry_ym":"2028-06"}');
  assert (r->>'usable')::boolean, 'clean: should be usable: ' || r;
  assert jsonb_array_length(r->'signs') = 0, 'clean: should have no signs: ' || r;
  assert r->'product'->>'name' = 'Demo Paracetamol Tablets', 'clean: product echo: ' || r;
  assert r->>'tips' = 'Check that the seal and hologram are intact.', 'clean: tips: ' || r;
  assert r->'checked' @> '["registration","name","batch_format","batch_record","expiry"]'::jsonb, 'clean: checks run: ' || r;

  -- Registration number belongs to a different product
  r := public.crosscheck_pack('{"nafdac_reg_no":"DEMO-A4-0001","product_name":"Amoxicillin capsules"}');
  assert r->'signs' @> '[{"code":"REG_NO_MISMATCH","field":"nafdac_reg_no"}]'::jsonb, 'name mismatch: ' || r;

  -- Registration number typed with different spacing and case still matches
  r := public.crosscheck_pack('{"nafdac_reg_no":" demo a4 0001 ","product_name":"paracetamol"}');
  assert jsonb_array_length(r->'signs') = 0, 'spacing and case should not matter: ' || r;

  -- Expired pack, and the current month is not expired
  r := public.crosscheck_pack('{"expiry_ym":"2024-01"}');
  assert r->'signs' @> '[{"code":"PACK_EXPIRED","field":"expiry_date"}]'::jsonb, 'expired: ' || r;
  assert (r->>'usable')::boolean, 'a sign makes the result usable: ' || r;
  r := public.crosscheck_pack(jsonb_build_object('expiry_ym', ym));
  assert jsonb_array_length(r->'signs') = 0, 'the current month is not expired: ' || r;

  -- Required details declared missing
  r := public.crosscheck_pack('{"missing":["batch_no"]}');
  assert r->'signs' @> '[{"code":"MANDATORY_FIELD_MISSING","field":"batch_no"}]'::jsonb, 'missing batch: ' || r;
  r := public.crosscheck_pack('{"batch_no":"PCM-2501","missing":["batch_no"]}');
  assert jsonb_array_length(r->'signs') = 0, 'a typed value wins over a missing flag: ' || r;

  -- Batch format
  r := public.crosscheck_pack('{"nafdac_reg_no":"DEMO-A4-0001","batch_no":"XYZ-1"}');
  assert r->'signs' @> '[{"code":"BATCH_FORMAT_MISMATCH","field":"batch_no"}]'::jsonb, 'batch format: ' || r;
  r := public.crosscheck_pack('{"nafdac_reg_no":"DEMO-A4-0001","batch_no":"pcm-2501"}');
  assert jsonb_array_length(r->'signs') = 0, 'batch format is not case sensitive: ' || r;

  -- Batch record contradicts the expiry on the pack; an unknown batch is not a sign
  r := public.crosscheck_pack('{"nafdac_reg_no":"DEMO-A4-0001","batch_no":"PCM-2501","expiry_ym":"2029-01"}');
  assert r->'signs' @> '[{"code":"PACK_CONTRADICTS_RECORD","field":"expiry_date"}]'::jsonb, 'batch record: ' || r;
  r := public.crosscheck_pack('{"nafdac_reg_no":"DEMO-A4-0001","batch_no":"PCM-7777","expiry_ym":"2029-01"}');
  assert jsonb_array_length(r->'signs') = 0, 'an unknown batch is not a sign: ' || r;

  -- Against a scanned code (VRXDEMO00001 is batch PCM-2501, expiry 2028-06)
  r := public.crosscheck_pack('{"nafdac_reg_no":"DEMO-A4-0001","batch_no":"PCM-2501","expiry_ym":"2028-06"}', 'VRXDEMO00001');
  assert jsonb_array_length(r->'signs') = 0, 'matching pack and code: ' || r;
  assert r->'checked' @> '["code_record"]'::jsonb, 'code comparison ran: ' || r;
  r := public.crosscheck_pack('{"nafdac_reg_no":"DEMO-A4-0001","batch_no":"PCM-9999"}', 'VRXDEMO00001');
  assert r->'signs' @> '[{"code":"PACK_CONTRADICTS_RECORD","field":"batch_no"}]'::jsonb, 'code vs batch: ' || r;
  r := public.crosscheck_pack('{"expiry_ym":"2029-01"}', 'VRXDEMO00001');
  assert r->'signs' @> '[{"code":"PACK_CONTRADICTS_RECORD","field":"expiry_date"}]'::jsonb, 'code vs expiry: ' || r;
  r := public.crosscheck_pack('{"nafdac_reg_no":"DEMO-A4-0002"}', 'VRXDEMO00001');
  assert r->'signs' @> '[{"code":"REG_NO_MISMATCH","field":"nafdac_reg_no"}]'::jsonb, 'code vs another product: ' || r;
  r := public.crosscheck_pack('{"nafdac_reg_no":"NOT-IN-OUR-RECORDS"}', 'VRXDEMO00001');
  assert r->'signs' @> '[{"code":"PACK_CONTRADICTS_RECORD","field":"nafdac_reg_no"}]'::jsonb, 'code vs unknown reg no: ' || r;
  r := public.crosscheck_pack('{"batch_no":"PCM-2501"}', 'VRXDEMO00001');
  assert r->'product'->>'name' = 'Demo Paracetamol Tablets', 'product comes from the code when no reg no: ' || r;

  -- Nothing to compare against means not usable
  r := public.crosscheck_pack('{"nafdac_reg_no":"ZZ-0000","batch_no":"B1","expiry_ym":"2030-01"}');
  assert not (r->>'usable')::boolean, 'unknown product: should not be usable: ' || r;
  assert jsonb_array_length(r->'signs') = 0, 'unknown product: no signs: ' || r;
  assert r->'product' = 'null'::jsonb, 'unknown product: no product echo: ' || r;

  -- Bad input is refused
  foreach t in array array[
    '[]', '"x"', '{"expiry_ym":"2028-13"}', '{"mfg_ym":"28-01"}', '{"nafdac_reg_no":5}',
    '{"missing":"batch_no"}', '{"missing":["colour"]}', '{"missing":[1]}',
    '{"batch_no":"' || repeat('9', 60) || '"}'
  ] loop
    begin
      perform public.crosscheck_pack(t::jsonb);
      raise exception 'accepted bad input: %', t;
    exception when others then
      assert sqlerrm = 'invalid_input', 'unexpected for ' || t || ': ' || sqlerrm;
    end;
  end loop;
end $$;

-- 3. Per-phone daily limit
reset role;
update app_config set value = 2 where key = 'max_analyses_per_day';
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","is_anonymous":true}', true);
end $$;
do $$
begin
  perform public.crosscheck_pack('{"expiry_ym":"2030-01"}');
  perform public.crosscheck_pack('{"expiry_ym":"2030-01"}');
  begin
    perform public.crosscheck_pack('{"expiry_ym":"2030-01"}');
    raise exception 'the third check was allowed';
  exception when others then
    assert sqlerrm = 'rate_limited', 'unexpected: ' || sqlerrm;
  end;
end $$;

-- 4. Global kill switch
reset role;
update app_config set value = 1000 where key = 'max_analyses_per_day';
update app_config set value = 1 where key = 'max_global_analyses_per_day';
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated","is_anonymous":true}', true);
end $$;
do $$
begin
  begin
    perform public.crosscheck_pack('{"expiry_ym":"2030-01"}');
    raise exception 'the global cap was ignored';
  exception when others then
    assert sqlerrm = 'rate_limited', 'unexpected: ' || sqlerrm;
  end;
end $$;

-- 5. Logging (as the database owner)
reset role;
do $$
begin
  assert (select count(*) from analyses
           where kind = 'pack' and model = 'typed-entry' and prompt_version = 'crosscheck@1') >= 8,
         'checks should be logged with the rules version';
  assert (select count(*) from analyses where kind = 'pack' and latency_ms is not null) >= 8,
         'latency should be logged';
  assert (select count(*) from analysis_usage where subject = 'u:00000000-0000-0000-0000-0000000000d1') = 1,
         'one usage row per phone per day';
end $$;

rollback;