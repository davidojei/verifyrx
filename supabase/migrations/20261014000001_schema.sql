-- VerifyRx schema. Run first.

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  manufacturer text not null check (length(manufacturer) between 1 and 200),
  nafdac_reg_no text not null unique check (length(nafdac_reg_no) between 1 and 50),
  active_ingredient text,
  strength text
);

create table batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products on delete cascade,
  batch_no text not null check (length(batch_no) between 1 and 100),
  mfg_date date,
  expiry_date date not null,
  status text not null default 'ok' check (status in ('ok','recalled')),
  unique (product_id, batch_no)
);

create table codes (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches on delete cascade,
  code_value text not null unique check (length(code_value) between 1 and 256),
  scan_count int not null default 0,
  first_scanned_at timestamptz
);

-- user_id has no foreign key on purpose: history survives deletion of anonymous accounts.
create table scans (
  id uuid primary key default gen_random_uuid(),
  code_value text not null,
  result text not null check (result in ('VERIFIED','SUSPICIOUS','CANT_CONFIRM')),
  user_id uuid,
  lat numeric(6,3),
  lng numeric(6,3),
  created_at timestamptz not null default now()
);

-- photo_url holds up to 3 storage paths, comma separated (private bucket).
create table reports (
  id uuid primary key default gen_random_uuid(),
  code_value text check (length(code_value) <= 256),
  product_name_text text check (length(product_name_text) <= 200),
  photo_url text check (length(photo_url) <= 500),
  notes text check (length(notes) <= 2000),
  lat numeric(6,3),
  lng numeric(6,3),
  status text not null default 'new' check (status in ('new','reviewed','confirmed_fake')),
  reporter_id uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (code_value is not null or product_name_text is not null or photo_url is not null)
);

create table app_config (key text primary key, value numeric not null);
create table admins (user_id uuid primary key references auth.users on delete cascade);
create table app_secrets (key text primary key, value text not null);

create index on scans (code_value);
create index on scans (user_id, created_at);
create index on reports (code_value);
create index on reports (reporter_id, created_at);
create index on batches (product_id);
create index on codes (batch_id);

-- Every flag_at_* threshold means: flag when value >= threshold.
insert into app_config (key, value) values
  ('flag_at_devices', 3),
  ('flag_at_areas', 2),
  ('flag_at_scans', 6),
  ('flag_at_reports', 3),
  ('area_cell_km', 5),
  ('max_reports_per_hour', 5),
  ('max_scans_per_minute', 30),
  ('rescan_window_hours', 24);

insert into app_secrets (key, value)
values ('code_hash_salt', replace(gen_random_uuid()::text, '-', ''));

create function public.cfg(p_key text) returns numeric
language sql stable security definer set search_path = public, pg_temp
as $$ select value from app_config where key = p_key $$;

-- Admins must be real (non-anonymous) accounts listed in `admins`.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     and exists (select 1 from admins where user_id = auth.uid())
$$;

revoke execute on function public.cfg(text) from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;