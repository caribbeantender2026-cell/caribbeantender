-- Existing tokens must observe deactivation for destructive operations too.
alter policy tenders_delete_own_draft on public.tenders
using (business_id = (select auth.uid()) and status = 'draft' and (select private.caller_is_active()));
alter policy form_submissions_delete_own_unfrozen on public.form_submissions
using (owner_id = (select auth.uid()) and (attached_to_type is null or attached_to_type = 'tender') and (select private.caller_is_active()));

alter policy tender_documents_remove_from_own_draft on storage.objects
using (bucket_id = 'tender-documents' and owner_id = (select auth.uid())::text
  and (select private.caller_is_active()) and private.is_own_draft_tender_folder((storage.foldername(name))[1]));
alter policy bid_documents_remove_own_before_submission on storage.objects
using (bucket_id = 'bid-documents' and owner_id = (select auth.uid())::text
  and (select private.caller_is_active()) and private.is_own_unsubmitted_bid_folder((storage.foldername(name))[2]));
alter policy account_pictures_remove_own on storage.objects
using (bucket_id = 'account-pictures' and owner_id = (select auth.uid())::text and (select private.caller_is_active()));

-- Serialize tender form writes with publication and deletion. FOR SHARE rechecks the
-- status after a concurrent transaction releases its lock, including on initial attachment.
create function private.lock_form_tender() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  submission public.form_submissions := case when tg_op = 'DELETE' then old else new end;
begin
  if submission.attached_to_type = 'tender' then
    perform 1 from public.tenders where id = submission.attached_to_id and status = 'draft' for share;
    if not found then
      raise exception 'This form cannot be changed: the tender was published or removed.' using errcode = '23514';
    end if;
  end if;
  return submission;
end;
$$;
create trigger check_form_tender before insert or update or delete on public.form_submissions
for each row execute function private.lock_form_tender();

-- Removing the row and the attached form commits together. The worker uses the
-- Storage API to delete bytes after commit, and keeps failed removals for retry.
create table public.draft_file_cleanup (
  path text primary key,
  queued_at timestamptz not null default now()
);
alter table public.draft_file_cleanup enable row level security;
revoke all on public.draft_file_cleanup from public, anon, authenticated;
grant select, delete, update on public.draft_file_cleanup to service_role;

create function private.remove_draft_contents() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'draft' then
    delete from public.form_submissions where attached_to_type = 'tender' and attached_to_id = old.id;
    insert into public.draft_file_cleanup(path)
      select name from storage.objects where bucket_id = 'tender-documents' and starts_with(name,old.id::text || '/')
      on conflict do nothing;
  end if;
  return old;
end;
$$;
create trigger remove_draft_contents before delete on public.tenders
for each row execute function private.remove_draft_contents();

-- A bounded rolling history per uploader and bucket. Updating the same quota row
-- serializes concurrent reservations and rolls back with an unsuccessful insert.
create table private.upload_history (
  owner_id text not null,
  bucket_id text not null,
  moments timestamptz[] not null,
  primary key(owner_id,bucket_id)
);
insert into private.upload_history
select owner_id, bucket_id, array_agg(created_at order by created_at desc)
from storage.objects where owner_id is not null and created_at > now() - interval '1 day'
and bucket_id in ('account-pictures','tender-documents','bid-documents') group by owner_id,bucket_id;

create function private.recent_uploads(moments timestamptz[]) returns timestamptz[]
language sql stable set search_path = '' as $$
  select array(select moment from unnest(moments) as moment where moment > statement_timestamp() - interval '1 day');
$$;

select cron.schedule('expire-upload-history','17 * * * *',
  'delete from private.upload_history where cardinality(private.recent_uploads(moments))=0');

create or replace function private.uploads_in_last_day(bucket_name text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select cardinality(private.recent_uploads(moments)) from private.upload_history
    where owner_id = (select auth.uid())::text and bucket_id = bucket_name),0);
$$;

create function private.record_storage_upload() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.bucket_id not in ('account-pictures','tender-documents','bid-documents') or new.owner_id is null then return new; end if;
  -- A draft cannot disappear between the Storage permission check and insertion.
  if new.bucket_id = 'tender-documents' then
    perform 1 from public.tenders where id = private.try_uuid(split_part(new.name,'/',1))
      and business_id::text = new.owner_id and status = 'draft' for share;
    if not found then raise exception 'The draft is no longer available for upload.' using errcode = '23514'; end if;
  end if;
  insert into private.upload_history as history (owner_id,bucket_id,moments)
  values (new.owner_id,new.bucket_id,array[statement_timestamp()])
  on conflict(owner_id,bucket_id) do update
    set moments = array_append(private.recent_uploads(history.moments),statement_timestamp())
    where cardinality(private.recent_uploads(history.moments)) < case when new.bucket_id='bid-documents' then 50 else 20 end;
  if not found then raise exception 'Daily upload limit reached.' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger record_storage_upload after insert on storage.objects
for each row execute function private.record_storage_upload();

-- Both reference tables are already required. Correct the labels on the
-- supplied form versions without modifying any answers or their field order.
update public.form_definitions as definition
set schema = jsonb_set(definition.schema, '{fields}', (
  select jsonb_agg(
    case field ->> 'name'
      when 'bid_references' then field || '{"label":"References (at least one; two recommended)"}'::jsonb
      when 'business_references' then field || '{"label":"Business references (at least one; two recommended)"}'::jsonb
      else field
    end order by position
  )
  from jsonb_array_elements(definition.schema -> 'fields') with ordinality as fields(field, position)
))
where (definition.key, definition.version) in (('supplier-proposal', 2), ('supplier-registration', 1));

-- Derive pending actions from the actual Auth state, including after a restart.
drop function public.admin_list_users(text,integer,integer);
create function public.admin_list_users(search text default null, page_size integer default 50, page_offset integer default 0)
returns table (
  user_id uuid,
  email text,
  full_name text,
  is_active boolean,
  business_name text,
  supplier_name text,
  staff_role public.staff_role,
  subscription_status public.subscription_status,
  trial_ends_at timestamptz,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  auth_sync_pending boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  maximum_page_size constant integer := 100;
  search_pattern text := '%' || replace(replace(replace(coalesce(btrim(admin_list_users.search), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  perform private.require_admin();
  return query
  select
    profile.id,
    account.email::text,
    profile.full_name,
    profile.is_active,
    business_name.company_name,
    supplier_name.company_name,
    staff.role,
    subscription.status,
    subscription.trial_ends_at,
    profile.created_at,
    account.last_sign_in_at,
    profile.is_active = coalesce(account.banned_until > now(),false)
  from public.profiles profile
  join auth.users account on account.id = profile.id
  left join public.company_names business_name on business_name.user_id = profile.id and business_name.account_type = 'business'
  left join public.company_names supplier_name on supplier_name.user_id = profile.id and supplier_name.account_type = 'supplier'
  left join public.staff_members staff on staff.user_id = profile.id
  left join public.subscriptions subscription on subscription.supplier_id = profile.id
  where admin_list_users.search is null
     or account.email ilike search_pattern
     or profile.full_name ilike search_pattern
     or business_name.company_name ilike search_pattern
     or supplier_name.company_name ilike search_pattern
  order by profile.created_at desc, profile.id
  limit least(greatest(admin_list_users.page_size, 1), maximum_page_size)
  offset greatest(admin_list_users.page_offset, 0);
end;
$$;

revoke all on function public.admin_list_users(text,integer,integer) from public, anon, authenticated;
grant execute on function public.admin_list_users(text,integer,integer) to authenticated;
create or replace function public.admin_list_tenders(status_filter public.tender_status default null, page_size integer default 50, page_offset integer default 0)
returns table (
  tender_id uuid,
  title text,
  business_id uuid,
  business_name text,
  category_name text,
  status public.tender_status,
  closes_at timestamptz,
  published_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  bid_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  maximum_page_size constant integer := 100;
begin
  perform private.require_admin();
  return query
  select
    tender.id,
    tender.title,
    tender.business_id,
    company.company_name,
    category.name,
    tender.status,
    tender.closes_at,
    tender.published_at,
    tender.closed_at,
    tender.cancelled_at,
    tender.cancelled_reason,
    case
      when private.bids_are_open(tender.id) then (select count(*) from public.bids bid where bid.tender_id = tender.id)
    end
  from public.tenders tender
  left join public.company_names company on company.user_id = tender.business_id and company.account_type = 'business'
  left join public.categories category on category.id = tender.category_id
  where admin_list_tenders.status_filter is null or tender.status = admin_list_tenders.status_filter
  order by tender.created_at desc, tender.id
  limit least(greatest(admin_list_tenders.page_size, 1), maximum_page_size)
  offset greatest(admin_list_tenders.page_offset, 0);
end;
$$;


-- An interrupted action can be repeated without duplicate audit entries. A
-- contrary request from a stale admin tab must wait until Auth is consistent.
create or replace function public.admin_set_user_active(user_id uuid, is_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := private.require_admin();
  current_active boolean;
  auth_banned boolean;
begin
  if admin_set_user_active.user_id = caller_id then
    raise exception 'You cannot deactivate your own account.' using errcode = '23514';
  end if;
  if admin_set_user_active.is_active is null then
    raise exception 'Choose whether to activate or deactivate the account.' using errcode = '23514';
  end if;
  select profile.is_active, coalesce(account.banned_until > now(),false)
    into current_active, auth_banned
  from public.profiles profile join auth.users account on account.id=profile.id
  where profile.id=admin_set_user_active.user_id for update of profile;
  if not found then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if current_active = admin_set_user_active.is_active then return; end if;
  if current_active = auth_banned then
    raise exception 'Retry the pending sign-in change before starting a different action.' using errcode = '23514';
  end if;
  update public.profiles profile set is_active=admin_set_user_active.is_active where profile.id=admin_set_user_active.user_id;
  perform private.write_audit_log(case when admin_set_user_active.is_active then 'admin_user_reactivated' else 'admin_user_deactivated' end,
    'user',admin_set_user_active.user_id);
end;
$$;

-- Provide a time reference for deadlines and subscription expiry on devices with clock drift.
create function public.server_time() returns timestamptz
language sql stable security invoker set search_path = '' as $$ select statement_timestamp() $$;
revoke all on function public.server_time() from public, anon, authenticated;
grant execute on function public.server_time() to authenticated;
