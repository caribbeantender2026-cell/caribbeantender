-- A1: trials and subscriptions move out of supplier_profiles into a table no user can write
-- (AUDIT.md issue 1, PRD section 7).
--
-- The row is keyed to the auth user, not to the supplier profile, and it is created at most once
-- per person. Deleting and recreating a supplier profile therefore can never start a new trial.
-- Only the service role and admin functions (security definer) write it.

create type public.subscription_status as enum ('trial', 'active', 'expired', 'cancelled');

create table public.subscriptions (
  supplier_id uuid primary key references auth.users (id) on delete cascade,
  status public.subscription_status not null,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  -- Carried over unchanged from supplier_profiles for Phase 3 (payments); nothing reads them yet.
  subscription_plan text,
  subscription_started_at timestamptz,
  payment_customer_id text,
  payment_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is
  'Supplier trial and subscription state, one row per person, kept even if the supplier profile is deleted. Written only by the service role and admin functions.';

-- Existing values are copied unchanged (PRD section 7). An empty status belongs to suppliers created
-- before trials existed, who have no access today; they become expired, so nobody gains or loses
-- access (OPEN_QUESTIONS.md, decision D2). Any other status this migration does not know stops it,
-- rather than being guessed at; DEPLOY.md runs a read-only check for this first.
do $$
declare
  unexpected_statuses text;
begin
  select string_agg(distinct supplier.subscription_status, ', ')
  into unexpected_statuses
  from public.supplier_profiles supplier
  where supplier.subscription_status not in ('trial', 'active', 'expired', 'cancelled');

  if unexpected_statuses is not null then
    raise exception 'supplier_profiles has subscription statuses this migration cannot copy unchanged: %. Decide how to map them before cutover (DEPLOY.md, pre-checks).', unexpected_statuses;
  end if;
end;
$$;

insert into public.subscriptions (
  supplier_id, status, trial_started_at, trial_ends_at, current_period_end,
  subscription_plan, subscription_started_at, payment_customer_id, payment_subscription_id
)
select
  supplier.user_id,
  coalesce(supplier.subscription_status, 'expired')::public.subscription_status,
  supplier.trial_started_at,
  supplier.trial_ends_at,
  supplier.subscription_ends_at,
  supplier.subscription_plan,
  supplier.subscription_started_at,
  supplier.payment_customer_id,
  supplier.payment_subscription_id
from public.supplier_profiles supplier;

create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create function private.start_supplier_trial() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- "do nothing" on conflict is the point: a person gets one trial, ever.
  insert into public.subscriptions (supplier_id, status, trial_started_at, trial_ends_at)
  values (new.user_id, 'trial', now(), now() + interval '14 days')
  on conflict (supplier_id) do nothing;
  return new;
end;
$$;

revoke all on function private.start_supplier_trial() from public, anon, authenticated;

drop trigger set_supplier_trial_on_insert on public.supplier_profiles;
drop function public.set_supplier_trial();

create trigger start_supplier_trial
after insert on public.supplier_profiles
for each row execute function private.start_supplier_trial();

-- Same rule as production: a trial counts until it ends; an active subscription counts until its
-- period ends, or indefinitely when no end is set (an admin can set a status by hand; there are no
-- payments yet). The bids migration replaces this function with a full-word parameter name.
create or replace function private.supplier_has_access(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions subscription
    where subscription.supplier_id = p_user_id
      and (
        (subscription.status = 'trial' and subscription.trial_ends_at > now())
        or (subscription.status = 'active' and (subscription.current_period_end is null or subscription.current_period_end > now()))
      )
  );
$$;

-- Payments are Phase 3 (OPEN_QUESTIONS.md, item 7). This production function writes the columns
-- dropped below, so it goes; subscription_plans and subscription_events stay untouched.
drop function private.process_subscription_payment(uuid, text, text, text, numeric, text, text, text);

alter table public.supplier_profiles
  drop column trial_started_at,
  drop column trial_ends_at,
  drop column subscription_status,
  drop column subscription_plan,
  drop column subscription_started_at,
  drop column subscription_ends_at,
  drop column payment_customer_id,
  drop column payment_subscription_id;

alter table public.subscriptions enable row level security;

create policy subscriptions_read_own on public.subscriptions
for select to authenticated
using (supplier_id = (select auth.uid()));

revoke all on public.subscriptions from public, anon, authenticated;
grant select on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;
