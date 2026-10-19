begin;
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000cc","role":"authenticated","is_anonymous":true}', true);
end $$;

do $$
declare a int; b int; r jsonb;
begin
  r := verify_code('VRXDEMO00004'); a := (r->'stats'->>'scan_count')::int;
  r := verify_code('VRXDEMO00004'); b := (r->'stats'->>'scan_count')::int;
  assert a = b, 'a repeat scan by the same phone must not raise the count (first ' || a || ', second ' || b || ')';
end $$;
rollback;