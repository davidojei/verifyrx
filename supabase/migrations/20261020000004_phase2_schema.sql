-- Phase 2, step 1: schema for photo analysis and pill identification.
-- Additive only: new tables, two new columns on products, a few app_config rows.

-- Feature flags: '*' = everywhere, a two-letter country row overrides it. All start OFF.
create table feature_flags (
  flag text not null check (length(flag) between 1 and 50),
  country text not null default '*' check (country = '*' or country ~ '^[A-Z]{2}$'),
  enabled boolean not null default false,
  primary key (flag, country)
);
insert into feature_flags (flag, country, enabled) values
  ('photo_analysis', '*', false),
  ('pill_id', '*', false),
  ('retain_photos', '*', false);

-- Per-product hints for the photo checks.
alter table products
  add column known_fake_signs text check (length(known_fake_signs) <= 2000),
  add column batch_pattern text check (length(batch_pattern) <= 100);

-- Official reference photos of a product's packaging (files live in the reference-images bucket).
create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products on delete cascade,
  view text not null check (view in ('front','back','batch_area','blister','other')),
  storage_path text not null check (length(storage_path) between 1 and 300),
  created_at timestamptz not null default now()
);
create index on product_images (product_id);

-- Pill reference records.
create table pills (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products on delete cascade,
  imprint text check (length(imprint) <= 50),
  shape text check (shape in ('round','oval','oblong','capsule','square','triangle','other')),
  colour text check (length(colour) <= 50),
  size_mm numeric(4,1) check (size_mm > 0 and size_mm <= 40),
  coating text check (coating in ('film','sugar','uncoated','capsule_hard','capsule_soft')),
  score_line boolean,
  image_path text check (length(image_path) <= 300),
  created_at timestamptz not null default now()
);
create index on pills (product_id);

-- Audit log of every analysis. Written by the Edge Function only.
create table analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('pack','pill')),
  input_hash text not null check (length(input_hash) between 1 and 128),
  code_value text check (length(code_value) <= 256),
  serial_state text check (serial_state in ('VERIFIED','SUSPICIOUS','CANT_CONFIRM')),
  photo_state text check (photo_state in ('NO_SIGNS','SIGNS_FOUND','INCONCLUSIVE')),
  final_state text check (final_state in ('VERIFIED','SUSPICIOUS','CANT_CONFIRM')),
  signs jsonb not null default '[]'::jsonb,
  extraction jsonb,
  visual jsonb,
  matches jsonb,
  model text,
  prompt_version text,
  latency_ms int check (latency_ms >= 0),
  cached boolean not null default false,
  input_tokens int,
  output_tokens int,
  est_cost_usd numeric(10,5),
  keep_photos boolean not null default false,
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index on analyses (user_id, created_at);
create index on analyses (input_hash);

create table analysis_feedback (
  analysis_id uuid not null references analyses on delete cascade,
  user_id uuid not null,
  helpful boolean not null,
  note text check (length(note) <= 1000),
  created_at timestamptz not null default now(),
  primary key (analysis_id, user_id)
);

-- Confirmed fakes and genuine examples, exportable as a dataset.
create table labelled_examples (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid references analyses on delete set null,
  product_id uuid references products on delete set null,
  label text not null check (label in ('genuine','fake')),
  source text not null check (source in ('admin_confirmed_report','admin_upload')),
  image_paths text[] not null default '{}',
  notes text check (length(notes) <= 2000),
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Daily counters for the limits. subject = 'u:<user id>' or 'ip:<hash>'.
create table analysis_usage (
  subject text not null check (length(subject) <= 100),
  day date not null,
  calls int not null default 0,
  est_cost_usd numeric(10,5) not null default 0,
  primary key (subject, day)
);

-- Saved results so identical photos are not paid for twice.
create table analysis_cache (
  input_hash text primary key check (length(input_hash) <= 128),
  kind text not null check (kind in ('pack','pill')),
  result jsonb not null,
  model text,
  prompt_version text,
  created_at timestamptz not null default now()
);

insert into app_config (key, value) values
  ('max_analyses_per_day', 10),
  ('max_analyses_per_hour_per_ip', 20),
  ('max_global_analyses_per_day', 200)
on conflict (key) do nothing;

-- Row level security: nothing is public. Admins can do everything.
alter table feature_flags     enable row level security;
alter table product_images    enable row level security;
alter table pills             enable row level security;
alter table analyses          enable row level security;
alter table analysis_feedback enable row level security;
alter table labelled_examples enable row level security;
alter table analysis_usage    enable row level security;
alter table analysis_cache    enable row level security;

revoke all on feature_flags, product_images, pills, analyses, analysis_feedback,
  labelled_examples, analysis_usage, analysis_cache from anon;

do $$
declare t text;
begin
  foreach t in array array['feature_flags','product_images','pills','analyses',
                           'analysis_feedback','labelled_examples','analysis_usage','analysis_cache']
  loop
    execute format(
      'create policy admin_all on public.%I for all to authenticated
         using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Flags as the apps see them: the country row wins, otherwise the global row.
create function public.get_flags(p_country text default 'NG') returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(flag, enabled), '{}'::jsonb)
  from (
    select distinct on (flag) flag, enabled
    from feature_flags
    where country in ('*', upper(coalesce(p_country, 'NG')))
    order by flag, (country = '*')
  ) f
$$;

create function public.flag_on(p_flag text, p_country text default 'NG') returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce((public.get_flags(p_country) ->> p_flag)::boolean, false) $$;

revoke execute on function public.get_flags(text) from public, anon;
revoke execute on function public.flag_on(text, text) from public, anon;
grant execute on function public.get_flags(text) to authenticated, service_role;
grant execute on function public.flag_on(text, text) to authenticated, service_role;

-- Feedback on your own analysis only.
create function public.submit_feedback(p_analysis_id uuid, p_helpful boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  if p_note is not null and length(p_note) > 1000 then raise exception 'note_too_long'; end if;
  if not exists (select 1 from analyses where id = p_analysis_id and user_id = v_uid) then
    raise exception 'not_found';
  end if;
  insert into analysis_feedback (analysis_id, user_id, helpful, note)
  values (p_analysis_id, v_uid, p_helpful, nullif(btrim(p_note), ''))
  on conflict (analysis_id, user_id)
  do update set helpful = excluded.helpful, note = excluded.note, created_at = now();
end $$;

-- Delete your own analysis. Returns the stored photo paths so the app can remove the files too.
create function public.delete_my_analysis(p_analysis_id uuid) returns text[]
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_paths text[];
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  delete from analyses where id = p_analysis_id and user_id = v_uid returning photo_paths into v_paths;
  if not found then raise exception 'not_found'; end if;
  return v_paths;
end $$;

revoke execute on function public.submit_feedback(uuid, boolean, text) from public, anon;
revoke execute on function public.delete_my_analysis(uuid) from public, anon;
grant execute on function public.submit_feedback(uuid, boolean, text) to authenticated;
grant execute on function public.delete_my_analysis(uuid) to authenticated;

-- Storage buckets (both private).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('reference-images', 'reference-images', false, 2097152, array['image/jpeg','image/png','image/webp']),
  ('analysis-photos',  'analysis-photos',  false, 1048576, array['image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy reference_images_admin_all on storage.objects for all to authenticated
  using (bucket_id = 'reference-images' and public.is_admin())
  with check (bucket_id = 'reference-images' and public.is_admin());

-- Users may keep a photo only while the retain_photos flag is on, and only in their own folder.
create policy analysis_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'analysis-photos'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.flag_on('retain_photos'));
create policy analysis_photos_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'analysis-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy analysis_photos_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'analysis-photos' and public.is_admin());