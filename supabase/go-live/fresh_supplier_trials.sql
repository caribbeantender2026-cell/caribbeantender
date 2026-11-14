-- Go-live only: gives every existing supplier a fresh free trial ending 14 days after go-live, so the
-- pilot suppliers can bid from day one. On 13 November 2026 none of the 6 could (4 expired, 2 with
-- trials that ended in October).
--
-- It is kept out of supabase/migrations so no earlier push applies it. At go-live, DEPLOY.md copies it
-- there under the go-live timestamp and applies it with the other migrations; it is never run by hand.
--
-- The 14 days is waiting on the client's confirmation (OPEN_QUESTIONS.md, item 32). A paid
-- subscription that is still running is left as it is, because a trial would replace it.
update public.subscriptions subscription
set
  status = 'trial',
  trial_started_at = now(),
  trial_ends_at = now() + interval '14 days'
where exists (select 1 from public.supplier_profiles supplier where supplier.user_id = subscription.supplier_id)
  and not (
    subscription.status = 'active'
    and (subscription.current_period_end is null or subscription.current_period_end > now())
  );
