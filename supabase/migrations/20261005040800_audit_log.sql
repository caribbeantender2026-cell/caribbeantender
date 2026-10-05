-- Append-only audit log of bid submissions, bid openings and bid document downloads.
--
-- Ids are stored without foreign keys on purpose: the log must never block a change elsewhere,
-- and nothing elsewhere may change or remove the log.

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  event_type text not null check (event_type in ('bid_submitted', 'bids_opened', 'bid_document_download')),
  actor_id uuid,
  tender_id uuid,
  bid_id uuid,
  details jsonb not null default '{}'
);

comment on table public.audit_log is
  'Append-only. bid_submitted and bids_opened are written by triggers; bid_document_download is recorded before a bid file can be read.';

create index audit_log_actor_event_time_idx on public.audit_log (actor_id, event_type, occurred_at desc);
create index audit_log_tender_idx on public.audit_log (tender_id);

create function private.reject_audit_log_changes() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The audit log is append-only' using errcode = 'check_violation';
end;
$$;

revoke all on function private.reject_audit_log_changes() from public, anon, authenticated;

create trigger audit_log_is_append_only
before update or delete on public.audit_log
for each row execute function private.reject_audit_log_changes();

create trigger audit_log_cannot_be_truncated
before truncate on public.audit_log
for each statement execute function private.reject_audit_log_changes();

-- The exact submission time is the bid's own created_at, set by the bid trigger.
create function private.log_bid_submission() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (event_type, occurred_at, actor_id, tender_id, bid_id, details)
  values (
    'bid_submitted',
    new.created_at,
    new.supplier_id,
    new.tender_id,
    new.id,
    jsonb_build_object('document_path', new.document_path, 'document_name', new.document_name)
  );
  return new;
end;
$$;

revoke all on function private.log_bid_submission() from public, anon, authenticated;

create trigger log_bid_submission
after insert on public.bids
for each row execute function private.log_bid_submission();

-- A tender moving from open to closed is the formal bid opening: the moment the seal breaks.
create function private.log_bids_opening() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'open' and new.status = 'closed' then
    insert into public.audit_log (event_type, tender_id, details)
    values (
      'bids_opened',
      new.id,
      jsonb_build_object(
        'closes_at', new.closes_at,
        'bid_count', (select count(*) from public.bids bid where bid.tender_id = new.id)
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function private.log_bids_opening() from public, anon, authenticated;

create trigger log_bids_opening
after update of status on public.tenders
for each row execute function private.log_bids_opening();

alter table public.audit_log enable row level security;

-- People can read their own entries, such as their bid receipts. Businesses do not read
-- submission events on their tenders: that would reveal who bid before the bids are opened.
create policy audit_log_read_own on public.audit_log
for select to authenticated
using (actor_id = (select auth.uid()));

-- A download is recorded by the person downloading, and only for a bid they can already see:
-- the subquery runs under the bids policies (own bid, or tender owner after closing).
create policy audit_log_record_own_download on public.audit_log
for insert to authenticated
with check (
  event_type = 'bid_document_download'
  and actor_id = (select auth.uid())
  and exists (
    select 1
    from public.bids bid
    where bid.id = audit_log.bid_id
      and bid.tender_id = audit_log.tender_id
      and bid.document_path = audit_log.details ->> 'document_path'
  )
);

revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated, service_role;
grant insert (event_type, actor_id, tender_id, bid_id, details) on public.audit_log to authenticated;
grant insert on public.audit_log to service_role;
