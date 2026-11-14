-- C1: replace the two name views that bypassed row-level security (AUDIT.md C1, PRD section 7).
--
-- A security_invoker view directly over business_profiles or supplier_profiles cannot work: RLS is
-- per row and column grants are per role, so letting other users read a profile row for its name
-- would also expose its phone number, address and email. Company names get their own narrow table
-- instead, kept in step by triggers, and the views read it as the caller.
--
-- Who can read: every signed-in user, every company name (PRD P1-03). A name on its own doesn't
-- show who bid on what; bids stay sealed by their own rules. Visitors who are not signed in see none.

create table public.company_names (
  user_id uuid not null references public.profiles (id) on delete cascade,
  account_type public.account_type not null,
  company_name text,
  primary key (user_id, account_type)
);

comment on table public.company_names is
  'Company names only, readable by signed-in users. Written by triggers on business_profiles and supplier_profiles; never by clients.';

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

create policy company_names_read_signed_in on public.company_names
for select to authenticated
using (true);

drop view public.business_names_public;
drop view public.supplier_names_public;

create view public.business_names_public with (security_invoker = true) as
select user_id, company_name from public.company_names where account_type = 'business';

create view public.supplier_names_public with (security_invoker = true) as
select user_id, company_name from public.company_names where account_type = 'supplier';

-- SELECT only, for signed-in users. "revoke all" also removes TRUNCATE, REFERENCES, TRIGGER and
-- MAINTAIN, which the old views granted to everyone.
revoke all on public.company_names, public.business_names_public, public.supplier_names_public
  from public, anon, authenticated, service_role;
grant select on public.company_names, public.business_names_public, public.supplier_names_public
  to authenticated, service_role;
