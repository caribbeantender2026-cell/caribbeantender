-- Subscriptions and trials move out of supplier_profiles into a table only the service role writes.
--
-- The trial belongs to the person (profiles.id), not to the supplier profile row. Previously a
-- new supplier_profiles row always started a fresh trial, so deleting and recreating the profile
-- reset it. Now the trial row is created once per person and survives the profile being deleted.

create type public.subscription_state as enum ('trialing', 'active', 'past_due', 'canceled', 'expired');

create table public.subscriptions (
  supplier_id uuid primary key references public.profiles (id) on delete cascade,
  status public.subscription_state not null,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  plan_code text references public.subscription_plans (plan_code),
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is
  'Supplier trial and subscription state. Written only by the service role (the payment webhook) and the trial trigger.';

-- Carry over existing state. Unknown plan codes are dropped rather than failing the migration.
insert into public.subscriptions (
  supplier_id, status, trial_started_at, trial_ends_at, plan_code,
  current_period_started_at, current_period_ends_at, provider_customer_id, provider_subscription_id
)
select
  supplier.user_id,
  case supplier.subscription_status
    when 'active' then 'active'
    when 'trial' then 'trialing'
    else 'expired'
  end::public.subscription_state,
  supplier.trial_started_at,
  supplier.trial_ends_at,
  (select plan.plan_code from public.subscription_plans plan where plan.plan_code = supplier.subscription_plan),
  supplier.subscription_started_at,
  supplier.subscription_ends_at,
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
  values (new.user_id, 'trialing', now(), now() + interval '14 days')
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

-- Same signature as before so the bid policy that calls it keeps working.
create or replace function private.supplier_has_access(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions subscription
    join public.supplier_profiles supplier on supplier.user_id = subscription.supplier_id
    where subscription.supplier_id = p_user_id
      and (
        (subscription.status = 'trialing' and subscription.trial_ends_at > now())
        -- An active subscription must have a paid-up period. The old rule also allowed an active
        -- status with no end date, which a client could never earn through payment.
        or (subscription.status = 'active' and subscription.current_period_ends_at > now())
      )
  );
$$;

-- Payment processing now writes subscriptions instead of supplier_profiles. Stage 2 replaces this
-- with the payment_events flow; until then it stays callable by postgres only.
create or replace function private.process_subscription_payment(
  p_supplier_id uuid,
  p_provider text,
  p_provider_event_id text,
  p_plan_code text,
  p_paid_amount numeric,
  p_paid_currency text,
  p_payment_customer_id text default null,
  p_payment_subscription_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_time timestamptz := now();
  current_status public.subscription_state;
  current_period_end timestamptz;
  plan_name text;
  expected_price numeric;
  expected_currency text;
  billing_interval text;
  interval_count integer;
  new_period_end timestamptz;
  event_id uuid;
begin
  if p_supplier_id is null then raise exception 'Supplier ID is required'; end if;
  if p_provider is null or btrim(p_provider) = '' then raise exception 'Payment provider is required'; end if;
  if p_provider_event_id is null or btrim(p_provider_event_id) = '' then raise exception 'Provider event ID is required'; end if;
  if p_plan_code is null or btrim(p_plan_code) = '' then raise exception 'Plan code is required'; end if;
  if p_paid_amount is null or p_paid_amount < 0 then raise exception 'Invalid payment amount'; end if;
  if p_paid_currency is null or btrim(p_paid_currency) = '' then raise exception 'Payment currency is required'; end if;

  select plan.plan_name, plan.price, plan.currency, plan.billing_interval, plan.interval_count
  into plan_name, expected_price, expected_currency, billing_interval, interval_count
  from public.subscription_plans plan
  where plan.plan_code = p_plan_code;
  if not found then raise exception 'Unknown subscription plan'; end if;

  if upper(btrim(p_paid_currency)) <> upper(btrim(expected_currency)) then
    raise exception 'Payment currency does not match subscription plan';
  end if;
  if p_paid_amount <> expected_price then
    raise exception 'Payment amount does not match subscription plan';
  end if;

  select subscription.status, subscription.current_period_ends_at
  into current_status, current_period_end
  from public.subscriptions subscription
  where subscription.supplier_id = p_supplier_id
  for update;
  if not found then raise exception 'Supplier subscription not found'; end if;

  if exists (
    select 1 from public.subscription_events event
    where event.provider = p_provider and event.provider_event_id = p_provider_event_id
  ) then
    return jsonb_build_object('success', true, 'duplicate', true, 'message', 'Event already processed');
  end if;

  -- Renewals extend from the current period end; anything else starts from now.
  new_period_end := case
    when current_status = 'active' and current_period_end > payment_time then current_period_end
    else payment_time
  end + case billing_interval
    when 'month' then make_interval(months => interval_count)
    when 'year' then make_interval(years => interval_count)
  end;
  if new_period_end is null then raise exception 'Unsupported subscription billing interval'; end if;

  insert into public.subscription_events (
    supplier_id, provider, provider_event_id, event_type, subscription_plan,
    amount, currency, status, occurred_at, metadata
  ) values (
    p_supplier_id, p_provider, p_provider_event_id, 'payment_succeeded', p_plan_code,
    expected_price, upper(expected_currency), 'processed', payment_time,
    jsonb_build_object(
      'plan_name', plan_name,
      'previous_status', current_status,
      'previous_period_end', current_period_end,
      'new_period_end', new_period_end
    )
  )
  returning id into event_id;

  update public.subscriptions
  set
    status = 'active',
    plan_code = p_plan_code,
    current_period_started_at = case when status = 'active' then coalesce(current_period_started_at, payment_time) else payment_time end,
    current_period_ends_at = new_period_end,
    provider = p_provider,
    provider_customer_id = coalesce(p_payment_customer_id, provider_customer_id),
    provider_subscription_id = coalesce(p_payment_subscription_id, provider_subscription_id)
  where supplier_id = p_supplier_id;

  return jsonb_build_object(
    'success', true,
    'duplicate', false,
    'event_id', event_id,
    'supplier_id', p_supplier_id,
    'plan_code', p_plan_code,
    'subscription_status', 'active',
    'current_period_ends_at', new_period_end
  );
end;
$$;

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

-- No insert, update or delete for anon or authenticated: only the service role writes.
revoke all on public.subscriptions from public, anon, authenticated;
grant select on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;
