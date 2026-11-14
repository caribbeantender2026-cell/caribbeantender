-- Basic admin for pilot support (PRD P1-15, P1-14, 8.6).
--
-- Staff are listed in staff_members. Phase 1 uses only the admin role; owner and support exist for
-- Phase 2. Admin actions go through security-definer functions that check the staff role, an active
-- profile, and a session signed in with two factors (the JWT's aal claim is aal2 after TOTP).
--
-- Admins see users and tender metadata, deactivate and reactivate users, cancel tenders and read
-- the audit log. They never see bid contents in Phase 1 (OPEN_QUESTIONS.md, item 19), and bid
-- counts only once bids are open.
--
-- The first admin is added by hand in the SQL Editor (DEPLOY.md). Blocking a deactivated user's
-- sign-in (an Auth ban) needs the service role, so an Edge Function does it in Stage 2; until then
-- every write function refuses deactivated users.

create type public.staff_role as enum ('owner', 'admin', 'support');

create table public.staff_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.staff_role not null,
  created_at timestamptz not null default now()
);

comment on table public.staff_members is
  'Platform staff. Phase 1 uses only the admin role. Rows are added by hand in the SQL Editor.';

alter table public.staff_members enable row level security;

-- Lets the app show the admin link to staff; nobody sees the staff list.
create policy staff_members_read_own on public.staff_members
for select to authenticated
using (user_id = (select auth.uid()));

revoke all on public.staff_members from public, anon, authenticated;
grant select on public.staff_members to authenticated;

-- For policies: an active admin (or owner) signed in with two factors.
create function private.caller_is_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
    and exists (
      select 1
      from public.staff_members staff
      join public.profiles profile on profile.id = staff.user_id
      where staff.user_id = (select auth.uid())
        and staff.role in ('owner', 'admin')
        and profile.is_active
    );
$$;

-- For admin functions: the same check, stopping with a reason a person can act on.
create function private.require_admin() returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_active_user();
begin
  if not exists (
    select 1 from public.staff_members staff
    where staff.user_id = caller_id and staff.role in ('owner', 'admin')
  ) then
    raise exception 'This needs an admin account.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Admin actions need two-step sign-in. Enter the code from your authenticator app first.'
      using errcode = 'insufficient_privilege';
  end if;
  return caller_id;
end;
$$;

create policy audit_log_read_admins on public.audit_log
for select to authenticated
using ((select private.caller_is_admin()));

grant select on public.audit_log to authenticated;

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
  last_sign_in_at timestamptz
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
    account.last_sign_in_at
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
  order by profile.created_at desc
  limit least(greatest(admin_list_users.page_size, 1), maximum_page_size)
  offset greatest(admin_list_users.page_offset, 0);
end;
$$;

-- Tender metadata only. The bid count is shown once bids are open; bid contents never are.
create function public.admin_list_tenders(status_filter public.tender_status default null, page_size integer default 50, page_offset integer default 0)
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
  order by tender.created_at desc
  limit least(greatest(admin_list_tenders.page_size, 1), maximum_page_size)
  offset greatest(admin_list_tenders.page_offset, 0);
end;
$$;

create function public.admin_set_user_active(user_id uuid, is_active boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_admin();
begin
  if admin_set_user_active.user_id = caller_id then
    raise exception 'You cannot deactivate your own account.' using errcode = 'check_violation';
  end if;
  update public.profiles profile
  set is_active = admin_set_user_active.is_active
  where profile.id = admin_set_user_active.user_id;
  if not found then
    raise exception 'User not found.' using errcode = 'no_data_found';
  end if;
  perform private.write_audit_log(
    case when admin_set_user_active.is_active then 'admin_user_reactivated' else 'admin_user_deactivated' end,
    'user',
    admin_set_user_active.user_id
  );
end;
$$;

create function public.admin_cancel_tender(tender_id uuid, reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  perform private.cancel_tender_now(admin_cancel_tender.tender_id, admin_cancel_tender.reason);
  perform private.write_audit_log('admin_tender_cancelled', 'tender', admin_cancel_tender.tender_id,
    jsonb_build_object('reason', btrim(admin_cancel_tender.reason)));
end;
$$;

revoke all on function private.caller_is_admin() from public, anon, authenticated;
revoke all on function private.require_admin() from public, anon, authenticated;
revoke all on function public.admin_list_users(text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_list_tenders(public.tender_status, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_set_user_active(uuid, boolean) from public, anon, authenticated;
revoke all on function public.admin_cancel_tender(uuid, text) from public, anon, authenticated;
grant execute on function private.caller_is_admin() to authenticated;
grant execute on function public.admin_list_users(text, integer, integer) to authenticated;
grant execute on function public.admin_list_tenders(public.tender_status, integer, integer) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;
grant execute on function public.admin_cancel_tender(uuid, text) to authenticated;
