-- Email delivery fixes from the 17 Nov 2026 review (tests/database/fixes/09-email-delivery.ts).
--
-- 1. A failed email is tried again, after a wait that grows with each try (5, 10, 15, 20 minutes), at
--    most five times, so a short Resend outage no longer loses a bid receipt. An email left "pending"
--    by a run that stopped halfway is treated the same way. send-notifications sends with Resend's
--    idempotency key, so retrying an email that did go out before the run stopped sends nothing twice.
-- 2. Tenders posted by the live test suites' accounts (rls-test-<run id>-...@example.com, the naming
--    scripts/cleanup-rls-test-data.ts relies on) alert and remind no real supplier, after go-live too.
-- 3. The bids-opened email knows how many bids came in, so a tender with none isn't told to read them.
-- 4. pg_cron gives send-notifications 30 seconds a call instead of pg_net's default 5: two calls timed
--    out on 17 Nov with nothing to send, and a batch of emails takes longer.
-- 5. tenders_description_length was added NOT VALID for legacy rows. No row breaks it (checked on
--    production on 17 Nov), and one that did would make close_expired_tenders fail for every tender.

alter table public.email_log
  add column attempts integer not null default 1,
  add column last_attempt_at timestamptz not null default now(),
  add constraint email_log_attempts_check check (attempts between 1 and 5);

-- Whether an email that didn't go out should be tried again now. The one rule for due_emails and reclaim_email.
create function private.email_retry_is_due(log public.email_log) returns boolean
language sql
stable
set search_path = ''
as $$
  select log.status in ('failed', 'pending')
    and log.attempts < 5
    and log.last_attempt_at < now() - make_interval(mins => 5 * log.attempts);
$$;

create or replace function public.due_emails(batch_size integer default 50) returns table (type text, recipient text, entity_id uuid, details jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with active_supplier as (
    select supplier.user_id, supplier.category_id, users.email, coalesce(preference.tender_alerts, true) as wants_tender_emails
    from public.supplier_profiles supplier
    join public.profiles profile on profile.id = supplier.user_id and profile.is_active
    join auth.users users on users.id = supplier.user_id
    left join public.notification_preferences preference on preference.user_id = supplier.user_id
  ),
  -- Tenders the live test suites post: nobody is told about them.
  test_tender as (
    select tender.id
    from public.tenders tender
    join auth.users business_user on business_user.id = tender.business_id
    where lower(business_user.email) like 'rls-test-%@example.com'
  ),
  due as (
    -- Bid receipt, with the exact submission time: within the hour after submitting.
    select 'bid_receipt' as type, users.email as recipient, bid.id as entity_id,
      jsonb_build_object('tender_id', tender.id, 'tender_title', tender.title, 'amount', bid.amount, 'currency', bid.currency, 'submitted_at', bid.submitted_at) as details
    from public.bids bid
    join public.tenders tender on tender.id = bid.tender_id
    join auth.users users on users.id = bid.supplier_id
    where bid.submitted_at > now() - interval '1 hour'

    union all
    -- New tender alert: suppliers in the tender's category who keep alerts on, within a day of publishing.
    select 'new_tender_alert', supplier.email, tender.id,
      jsonb_build_object('tender_id', tender.id, 'tender_title', tender.title, 'closes_at', tender.closes_at)
    from public.tenders tender
    join active_supplier supplier on supplier.category_id = tender.category_id and supplier.wants_tender_emails
    where tender.status = 'open' and tender.published_at > now() - interval '1 day' and tender.closes_at > now()
      and supplier.user_id <> tender.business_id
      and tender.id not in (select test_tender.id from test_tender)

    union all
    -- Deadline reminder: 24 hours before closing, suppliers in the category who haven't bid. Only for
    -- tenders published more than a day before closing, so it never arrives together with the alert.
    -- Suppliers who turned tender alerts off get no reminders either (OPEN_QUESTIONS.md, item 33).
    select 'deadline_reminder', supplier.email, tender.id,
      jsonb_build_object('tender_id', tender.id, 'tender_title', tender.title, 'closes_at', tender.closes_at)
    from public.tenders tender
    join active_supplier supplier on supplier.category_id = tender.category_id and supplier.wants_tender_emails
    where tender.status = 'open' and tender.closes_at > now() and tender.closes_at <= now() + interval '24 hours'
      and tender.published_at <= tender.closes_at - interval '24 hours'
      and supplier.user_id <> tender.business_id
      and not exists (select 1 from public.bids bid where bid.tender_id = tender.id and bid.supplier_id = supplier.user_id)
      and tender.id not in (select test_tender.id from test_tender)

    union all
    -- Bids opened: the business, within a day of the tender closing, with how many bids came in.
    select 'bids_opened', users.email, tender.id,
      jsonb_build_object('tender_id', tender.id, 'tender_title', tender.title, 'closed_at', tender.closed_at,
        'bid_count', (select count(*) from public.bids bid where bid.tender_id = tender.id))
    from public.tenders tender
    join public.profiles profile on profile.id = tender.business_id and profile.is_active
    join auth.users users on users.id = tender.business_id
    where tender.status in ('closed', 'awarded') and tender.closed_at > now() - interval '1 day'
  )
  select due.type, due.recipient::text, due.entity_id, due.details
  from due
  where due.recipient is not null
    and not exists (
      select 1 from public.email_log log
      where log.type = due.type and log.recipient = due.recipient and log.entity_id = due.entity_id
        and not private.email_retry_is_due(log)
    )
  order by due.type, due.entity_id
  limit least(greatest(batch_size, 1), 500);
$$;

-- Takes an email that is due for another try back to "pending", for one run only: a second run that
-- reads the same due email gets false and leaves it alone. Service role only, like email_log.
create function public.reclaim_email(email_type text, email_recipient text, email_entity_id uuid) returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with reclaimed as (
    update public.email_log log
    set status = 'pending', attempts = log.attempts + 1, last_attempt_at = now(), provider_message_id = null
    where log.type = email_type and log.recipient = email_recipient and log.entity_id = email_entity_id
      and private.email_retry_is_due(log)
    returning log.id
  )
  select exists (select 1 from reclaimed);
$$;

revoke all on function private.email_retry_is_due(public.email_log) from public, anon, authenticated;
revoke all on function public.reclaim_email(text, text, uuid) from public, anon, authenticated;
grant execute on function public.reclaim_email(text, text, uuid) to service_role;

-- The same job as 20261114010000, with a 30-second timeout; cron.schedule replaces a job of the same name.
select cron.schedule(
  'send-notifications',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'send_notifications_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'send_notifications_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'send_notifications_url')
    and exists (select 1 from vault.decrypted_secrets where name = 'send_notifications_cron_secret');
  $job$
);

alter table public.tenders validate constraint tenders_description_length;
