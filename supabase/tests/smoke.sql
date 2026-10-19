-- Run on a freshly seeded database (it expects the demo codes to be unscanned).
-- Everything is rolled back at the end.
begin;

insert into auth.users (id, aud, role, is_anonymous)
values ('00000000-0000-0000-0000-0000000000aa', 'authenticated', 'authenticated', true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated","is_anonymous":true}', true);

do $$
declare r jsonb;
begin
  r := verify_code('VRXDEMO00001'); assert r->>'state' = 'VERIFIED',   'fresh code: '||r;
  r := verify_code('VRXDEMO00003'); assert r->>'state' = 'SUSPICIOUS' and r->'reasons' ? 'HIGH_SCAN_COUNT', r::text;
  r := verify_code('VRXDEMO00005'); assert r->'reasons' ? 'EXPIRED',        r::text;
  r := verify_code('VRXDEMO00008'); assert r->'reasons' ? 'MANY_DEVICES' and r->'reasons' ? 'MANY_LOCATIONS', r::text;
  r := verify_code('VRXDEMO00010'); assert r->'reasons' ? 'RECALLED',       r::text;
  r := verify_code('VRXDEMO00014'); assert r->'reasons' ? 'REPORTED_FAKE',  r::text;
  r := verify_code('VRXDEMO99999'); assert r->>'state' = 'CANT_CONFIRM',    r::text;

  r := verify_code('VRXDEMO00002');
  assert (r->'stats'->>'scan_count')::int = 1, 'scan_count should be 1';

  assert (select count(*) from codes)   = 0, 'public must not read codes';
  assert (select count(*) from scans)   = 0, 'public must not read scans';
  assert (select count(*) from reports) = 0, 'public must not read reports';

  begin
    insert into reports (reporter_id, product_name_text) values (gen_random_uuid(), 'x');
    raise exception 'spoofed reporter was allowed';
  exception when sqlstate '42501' then null; end;

  for i in 1..5 loop insert into reports (product_name_text) values ('test '||i); end loop;
  begin
    insert into reports (product_name_text) values ('one too many');
    raise exception 'rate limit not enforced';
  exception when others then
    assert sqlerrm = 'rate_limited', 'unexpected: '||sqlerrm;
  end;
end $$;

rollback;