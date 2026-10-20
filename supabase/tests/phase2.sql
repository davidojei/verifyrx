-- Phase 2, step 1 checks. Everything is rolled back at the end.
begin;

-- Setup as the database owner.
insert into feature_flags (flag, country, enabled) values ('photo_analysis', 'NG', true);

insert into analyses (id, user_id, kind, input_hash, photo_paths) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000a1', 'pack', 'hash-a',
   array['00000000-0000-0000-0000-0000000000a1/p1.jpg']),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000b1', 'pack', 'hash-b', '{}');

insert into auth.users (id, aud, role, is_anonymous)
values ('00000000-0000-0000-0000-0000000000ad', 'authenticated', 'authenticated', false);
insert into admins (user_id) values ('00000000-0000-0000-0000-0000000000ad');

-- Act as an anonymous phone user (user A).
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":true}', true);
end $$;

do $$
begin
  assert (public.get_flags('NG') ->> 'photo_analysis')::boolean = true,  'the NG override should be on';
  assert (public.get_flags('GH') ->> 'photo_analysis')::boolean = false, 'other countries use the global value (off)';
  assert (public.get_flags('NG') ->> 'pill_id')::boolean = false,        'pill_id should default to off';
  assert (public.get_flags() ->> 'retain_photos')::boolean = false,      'retain_photos should default to off';

  assert (select count(*) from feature_flags)     = 0, 'public must not read feature_flags';
  assert (select count(*) from product_images)    = 0, 'public must not read product_images';
  assert (select count(*) from pills)             = 0, 'public must not read pills';
  assert (select count(*) from analyses)          = 0, 'public must not read analyses';
  assert (select count(*) from analysis_feedback) = 0, 'public must not read feedback';
  assert (select count(*) from labelled_examples) = 0, 'public must not read labelled_examples';
  assert (select count(*) from analysis_usage)    = 0, 'public must not read analysis_usage';
  assert (select count(*) from analysis_cache)    = 0, 'public must not read analysis_cache';

  begin
    insert into feature_flags (flag, country, enabled) values ('x', '*', true);
    raise exception 'public insert into feature_flags was allowed';
  exception when sqlstate '42501' then null; end;

  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('analysis-photos', '00000000-0000-0000-0000-0000000000a1/t.jpg', '00000000-0000-0000-0000-0000000000a1');
    raise exception 'photo upload was allowed while retain_photos is off';
  exception when sqlstate '42501' then null; end;

  perform public.submit_feedback('00000000-0000-0000-0000-00000000a001', true, 'useful');
  begin
    perform public.submit_feedback('00000000-0000-0000-0000-00000000b001', true, null);
    raise exception 'feedback on someone else''s analysis was allowed';
  exception when others then
    assert sqlerrm = 'not_found', 'unexpected: ' || sqlerrm;
  end;
end $$;

reset role;
do $$ begin
  assert (select count(*) from analysis_feedback) = 1, 'exactly one feedback row should exist';
end $$;

set local role authenticated;
do $$
declare paths text[];
begin
  begin
    perform public.delete_my_analysis('00000000-0000-0000-0000-00000000b001');
    raise exception 'deleting someone else''s analysis was allowed';
  exception when others then
    assert sqlerrm = 'not_found', 'unexpected: ' || sqlerrm;
  end;
  paths := public.delete_my_analysis('00000000-0000-0000-0000-00000000a001');
  assert paths = array['00000000-0000-0000-0000-0000000000a1/p1.jpg'], 'wrong photo paths: ' || coalesce(paths::text, 'null');
end $$;

reset role;
do $$ begin
  assert (select count(*) from analyses where user_id = '00000000-0000-0000-0000-0000000000a1') = 0, 'own analysis should be gone';
  assert (select count(*) from analysis_feedback) = 0, 'feedback should be removed with its analysis';
  assert (select count(*) from analyses) = 1, 'the other user''s analysis must be untouched';
end $$;

-- Act as the admin.
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated","is_anonymous":false}', true);
end $$;
do $$
declare n int;
begin
  assert public.is_admin(), 'the admin should be recognised';
  update feature_flags set enabled = true where flag = 'pill_id' and country = '*';
  get diagnostics n = row_count;
  assert n = 1, 'an admin should be able to change a flag';
  assert (select count(*) from feature_flags) >= 4, 'an admin should be able to read the flags';
end $$;

rollback;