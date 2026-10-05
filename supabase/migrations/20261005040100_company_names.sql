-- C1 / P1: replace the two name views that bypassed row-level security.
--
-- A security_invoker view over business_profiles or supplier_profiles cannot work here: RLS is
-- per row and column grants are per role, so a policy letting a business read a bidder's row would
-- also expose that bidder's phone, address and email. Instead, company names get their own narrow
-- table holding nothing else, kept in sync by triggers, and the views read from it as the caller.
--
-- Who may read a name is decided by reusing the existing rules rather than restating them:
--   * a business name is visible to anyone who can see one of that business's tenders;
--   * a supplier name is visible to anyone who can see one of that supplier's bids
--     (so it stays hidden while bids are sealed);
--   * everyone can see their own names.

create table public.company_names (
  user_id uuid not null references public.profiles (id) on delete cascade,
  account_type public.account_type not null,
  company_name text,
  primary key (user_id, account_type)
);

comment on table public.company_names is
  'Public-facing company names only. Written by triggers on business_profiles and supplier_profiles; never by clients.';

insert into public.company_names (user_id, account_type, company_name)
select user_id, 'business'::public.account_type, company_name from public.business_profiles
union all
select user_id, 'supplier'::public.account_type, company_name from public.supplier_profiles;

create function private.sync_company_name() returns trigger
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

  insert into public.company_names (user_id, account_type, company_name)
  values (new.user_id, profile_account_type, new.company_name)
  on conflict (user_id, account_type) do update set company_name = excluded.company_name;
  return new;
end;
$$;

revoke all on function private.sync_company_name() from public, anon, authenticated;

create trigger sync_business_company_name
after insert or update of company_name or delete on public.business_profiles
for each row execute function private.sync_company_name('business');

create trigger sync_supplier_company_name
after insert or update of company_name or delete on public.supplier_profiles
for each row execute function private.sync_company_name('supplier');

alter table public.company_names enable row level security;

create policy company_names_read_business on public.company_names
for select to anon, authenticated
using (
  account_type = 'business'
  and (
    user_id = (select auth.uid())
    or exists (select 1 from public.tenders tender where tender.business_id = company_names.user_id)
  )
);

create policy company_names_read_supplier on public.company_names
for select to authenticated
using (
  account_type = 'supplier'
  and (
    user_id = (select auth.uid())
    or exists (select 1 from public.bids bid where bid.supplier_id = company_names.user_id)
  )
);

drop view public.business_names_public;
drop view public.supplier_names_public;

create view public.business_names_public with (security_invoker = true) as
select user_id, company_name from public.company_names where account_type = 'business';

create view public.supplier_names_public with (security_invoker = true) as
select user_id, company_name from public.company_names where account_type = 'supplier';

-- Read-only for everyone except the service role. "revoke all" also removes TRUNCATE,
-- REFERENCES, TRIGGER and MAINTAIN, which the old views granted.
revoke all on public.company_names, public.business_names_public, public.supplier_names_public
  from public, anon, authenticated, service_role;
grant select on public.company_names, public.business_names_public to anon, authenticated, service_role;
grant select on public.supplier_names_public to authenticated, service_role;
