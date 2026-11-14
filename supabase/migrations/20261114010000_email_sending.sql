-- The platform's emails (PRD P1-13). Every minute pg_cron calls the send-notifications Edge Function,
-- which reads what is due from public.due_emails and sends each email through email_log, so it goes
-- out at most once, and only to EMAIL_ALLOWLIST until go-live (OPEN_QUESTIONS.md, decision D3).
--
-- Each email type has a time window, so events from before the sender existed (such as the bids of
-- August 2026) never produce a backlog of emails.

create extension if not exists pg_net with schema extensions;

-- Every email that is due and not yet in email_log. Service role only: it reads auth.users emails.
create function public.due_emails(batch_size integer default 50) returns table (type text, recipient text, entity_id uuid, details jsonb)
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

    union all
    -- Bids opened: the business, within a day of the tender closing.
    select 'bids_opened', users.email, tender.id,
      jsonb_build_object('tender_id', tender.id, 'tender_title', tender.title, 'closed_at', tender.closed_at)
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
    )
  order by due.type, due.entity_id
  limit least(greatest(batch_size, 1), 500);
$$;

revoke all on function public.due_emails(integer) from public, anon, authenticated;
grant execute on function public.due_emails(integer) to service_role;

-- The shared secret pg_cron sends, for send-notifications to check against. It lives only in Vault,
-- so it is never copied into a dashboard field or an Edge Function setting. Service role only.
-- plpgsql, so the body is only checked when called (the local test database has no Vault).
create function public.notifications_cron_secret() returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (select secret.decrypted_secret from vault.decrypted_secrets secret where secret.name = 'send_notifications_cron_secret');
end;
$$;

revoke all on function public.notifications_cron_secret() from public, anon, authenticated;
grant execute on function public.notifications_cron_secret() to service_role;

-- The Edge Function's address and the shared secret live in Vault, set once per project (DEPLOY.md,
-- step 9), so neither is in this file and no key is stored in the database. Until both are set, the
-- job does nothing.
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
    body := '{}'::jsonb
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'send_notifications_url')
    and exists (select 1 from vault.decrypted_secrets where name = 'send_notifications_cron_secret');
  $job$
);
