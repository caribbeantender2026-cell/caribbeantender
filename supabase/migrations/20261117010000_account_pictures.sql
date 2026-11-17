-- Account pictures: each business and supplier account may show a picture of its choice next to its
-- company name, to every signed-in user (Tevin, 2026-11-17).
--
-- The files go in a public bucket, one folder per person: account-pictures/{user_id}/{uuid}.webp (or
-- .png where the browser can't encode WebP). Public because every signed-in user may see them and
-- anyone can sign up, so "anyone with the link" exposes nothing more, and a public link can be cached.
-- The app shrinks each picture to 256 pixels in the browser before uploading, which also drops photo
-- metadata such as GPS location; the bucket limits bound what a modified client could send instead.
--
-- Others see the picture through company_names, the narrow table that already shares company names,
-- kept in step by the same trigger.

alter table public.business_profiles
  add column picture_path text,
  -- Only a file in the owner's own folder, named the way the app names uploads.
  add constraint business_profiles_picture_in_own_folder
    check (picture_path is null or picture_path ~ ('^' || user_id::text || '/[0-9a-f-]{36}\.(webp|png)$'));

alter table public.supplier_profiles
  add column picture_path text,
  add constraint supplier_profiles_picture_in_own_folder
    check (picture_path is null or picture_path ~ ('^' || user_id::text || '/[0-9a-f-]{36}\.(webp|png)$'));

alter table public.company_names add column picture_path text;

grant update (picture_path) on public.business_profiles, public.supplier_profiles to authenticated;

create or replace function private.sync_company_name() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_account_type public.account_type := tg_argv[0]::public.account_type;
begin
  if tg_op = 'DELETE' then
    delete from public.company_names
    where user_id = old.user_id and account_type = profile_account_type;
    return old;
  end if;

  insert into public.company_names (user_id, account_type, company_name, picture_path)
  values (new.user_id, profile_account_type, new.company_name, new.picture_path)
  on conflict (user_id, account_type) do update
    set company_name = excluded.company_name, picture_path = excluded.picture_path;
  return new;
end;
$$;

-- The triggers fired only on company_name changes; they now fire on picture changes too.
drop trigger sync_business_company_name on public.business_profiles;
create trigger sync_business_company_name
after insert or update of company_name, picture_path or delete on public.business_profiles
for each row execute function private.sync_company_name('business');

drop trigger sync_supplier_company_name on public.supplier_profiles;
create trigger sync_supplier_company_name
after insert or update of company_name, picture_path or delete on public.supplier_profiles
for each row execute function private.sync_company_name('supplier');

-- 1 MB is far above a 256-pixel picture; WebP and PNG are the only types the browser shrink produces.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('account-pictures', 'account-pictures', true, 1048576, array['image/webp', 'image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy account_pictures_upload_to_own_folder on storage.objects
for insert to authenticated
with check (
  bucket_id = 'account-pictures'
  and (select private.caller_is_active())
  and cardinality(storage.foldername(name)) = 1
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.uploads_in_last_day('account-pictures')) < 20
);

-- Removing a file through the Storage API needs read access to it as well as delete.
create policy account_pictures_manage_own on storage.objects
for select to authenticated
using (bucket_id = 'account-pictures' and owner_id = (select auth.uid())::text);

create policy account_pictures_remove_own on storage.objects
for delete to authenticated
using (bucket_id = 'account-pictures' and owner_id = (select auth.uid())::text);
