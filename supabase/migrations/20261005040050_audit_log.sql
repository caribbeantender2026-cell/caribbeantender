-- Append-only audit log (PRD P1-14).
--
-- Rows are written only by triggers and security-definer functions, through private.write_audit_log.
-- No role may change or delete a row, not even the service role or the table owner. Admins read
-- the log through a policy added with the staff table (20261005041060); nobody else reads it.
--
-- Entity ids are stored without foreign keys on purpose: the log must never block a change
-- elsewhere, and nothing elsewhere may remove its rows.

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  -- Null when the system acted, for example the scheduled job that closes tenders.
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint audit_log_action_check check (action in (
    'tender_published',
    'tender_edited',
    'tender_closed',
    'tender_awarded',
    'tender_cancelled',
    'bid_submitted',
    'bids_opened',
    'document_download_url_issued',
    'admin_user_deactivated',
    'admin_user_reactivated',
    'admin_tender_cancelled'
  )),
  constraint audit_log_entity_type_check check (entity_type in ('tender', 'bid', 'document', 'user')),
  constraint audit_log_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

comment on table public.audit_log is
  'Append-only record of tender, bid, download and admin events. Written only by triggers and security-definer functions; readable by admins only.';

create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc);
create index audit_log_action_idx on public.audit_log (action, occurred_at desc);

-- Shared by every write-once table: the trigger passes the message to show.
create function private.reject_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', tg_argv[0] using errcode = 'check_violation';
end;
$$;

create trigger audit_log_is_append_only
before update or delete on public.audit_log
for each row execute function private.reject_change('The audit log is append-only: rows cannot be changed or deleted.');

create trigger audit_log_cannot_be_truncated
before truncate on public.audit_log
for each statement execute function private.reject_change('The audit log is append-only: rows cannot be changed or deleted.');

-- The one way rows get in. The actor is always the signed-in caller (or null for the system),
-- never a value a caller passes in.
create function private.write_audit_log(
  logged_action text,
  logged_entity_type text,
  logged_entity_id uuid,
  logged_metadata jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), logged_action, logged_entity_type, logged_entity_id, logged_metadata);
$$;

alter table public.audit_log enable row level security;

revoke all on public.audit_log from public, anon, authenticated;
revoke all on function private.reject_change() from public, anon, authenticated;
revoke all on function private.write_audit_log(text, text, uuid, jsonb) from public, anon, authenticated;
