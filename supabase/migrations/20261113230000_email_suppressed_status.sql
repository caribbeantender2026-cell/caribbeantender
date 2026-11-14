-- Email safety until go-live (OPEN_QUESTIONS.md, decision D3): an email to an address outside the
-- EMAIL_ALLOWLIST Edge Function setting is recorded as 'suppressed' and never sent. The row also stops
-- the same event emailing that address after go-live.
alter table public.email_log
  drop constraint email_log_status_check,
  add constraint email_log_status_check check (status in ('pending', 'sent', 'failed', 'suppressed'));
