-- Row level security, report rate limit, photo storage. Run second.

alter table products    enable row level security;
alter table batches     enable row level security;
alter table codes       enable row level security;
alter table scans       enable row level security;
alter table reports     enable row level security;
alter table app_config  enable row level security;
alter table admins      enable row level security;
alter table app_secrets enable row level security;

revoke all on products, batches, codes, scans, reports, app_config, admins, app_secrets from anon;

do $$
declare t text;
begin
  foreach t in array array['products','batches','codes','scans','reports','app_config','admins','app_secrets']
  loop
    execute format(
      'create policy admin_all on public.%I for all to authenticated
         using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Public: insert reports as themselves, status forced to 'new'. No SELECT.
create policy reports_insert_own on reports for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'new');

create function public.reports_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.reporter_id is not null and
     (select count(*) from reports
       where reporter_id = new.reporter_id
         and created_at > now() - interval '1 hour') >= public.cfg('max_reports_per_hour')
  then
    raise exception 'rate_limited';
  end if;
  new.code_value := nullif(btrim(new.code_value), '');
  new.lat := round(new.lat, 2);
  new.lng := round(new.lng, 2);
  return new;
end $$;

create trigger reports_before_insert before insert on reports
  for each row execute function public.reports_before_insert();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy report_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'report-photos'
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy report_photos_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'report-photos' and public.is_admin());
create policy report_photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'report-photos' and public.is_admin());