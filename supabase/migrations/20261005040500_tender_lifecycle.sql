-- Tender lifecycle: draft -> open -> closed -> awarded, and cancelled from draft, open or closed.
--
-- Access rules never wait for the scheduled job below: accepting bids and unsealing them compare
-- closes_at with the current time directly. The job only moves status from open to closed (which
-- records the opening in the audit log) within a minute of closes_at.

alter table public.tenders
  add column published_at timestamptz,
  add column closed_at timestamptz,
  add column cancelled_at timestamptz,
  add column awarded_at timestamptz,
  add column awarded_bid_id uuid;

-- Existing tenders were all published when created. A cancelled tender's last update is the best
-- record of when it was cancelled; updated_at is left untouched so that stays true.
-- closed_at marks a tender whose bids have been opened (see the sealed bids migration). Under the
-- old rules a business could already read bids once the date had passed, so every tender that
-- reached its deadline before being cancelled counts as opened.
alter table public.tenders disable trigger tenders_updated;
update public.tenders
set
  published_at = created_at,
  cancelled_at = case when status = 'cancelled' then updated_at end,
  closed_at = case
    when status = 'closed' then closes_at
    when status = 'open' and closes_at <= now() then closes_at
    when status = 'cancelled' and updated_at >= closes_at then closes_at
  end,
  status = case when status = 'open' and closes_at <= now() then 'closed' else status end;
alter table public.tenders enable trigger tenders_updated;

alter table public.tenders alter column status set default 'draft';

-- An award must name a bid on the same tender; the composite key makes that a declarative rule.
alter table public.bids add constraint bids_id_tender_id_key unique (id, tender_id);
alter table public.tenders
  add constraint tenders_awarded_bid_fkey foreign key (awarded_bid_id, id) references public.bids (id, tender_id),
  add constraint tenders_award_matches_status check ((status = 'awarded') = (awarded_bid_id is not null));

-- Deleting a tender must never delete the bids submitted to it (AUDIT.md M2).
alter table public.bids
  drop constraint bids_tender_id_fkey,
  add constraint bids_tender_id_fkey foreign key (tender_id) references public.tenders (id) on delete restrict;

create function private.enforce_tender_lifecycle() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'open') then
      raise exception 'A new tender must be a draft or open, not %', new.status using errcode = 'check_violation';
    end if;
    new.published_at := null;
    new.closed_at := null;
    new.cancelled_at := null;
    new.awarded_at := null;
    if new.status = 'open' then
      if new.closes_at <= now() then
        raise exception 'The closing time must be in the future' using errcode = 'check_violation';
      end if;
      new.published_at := now();
    end if;
    return new;
  end if;

  -- The lifecycle timestamps record transitions, so nobody sets them directly.
  new.published_at := old.published_at;
  new.closed_at := old.closed_at;
  new.cancelled_at := old.cancelled_at;
  new.awarded_at := old.awarded_at;

  -- Suppliers price their bids against the published terms, so those are fixed once published (AUDIT.md M2).
  if old.status <> 'draft' and (
    new.business_id is distinct from old.business_id
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.closes_at is distinct from old.closes_at
    or new.document_path is distinct from old.document_path
    or new.document_name is distinct from old.document_name
  ) then
    raise exception 'A published tender cannot be edited' using errcode = 'check_violation';
  end if;

  if new.status is not distinct from old.status then
    if new.awarded_bid_id is distinct from old.awarded_bid_id then
      raise exception 'The awarded bid can only be set when awarding the tender' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  case
    when old.status = 'draft' and new.status = 'open' then
      if new.closes_at <= now() then
        raise exception 'The closing time must be in the future' using errcode = 'check_violation';
      end if;
      new.published_at := now();
    when old.status = 'open' and new.status = 'closed' then
      -- Closing unseals the bids, so it can never happen before the deadline.
      if new.closes_at > now() then
        raise exception 'This tender closes automatically at %', new.closes_at using errcode = 'check_violation';
      end if;
      new.closed_at := now();
    when old.status = 'closed' and new.status = 'awarded' then
      new.awarded_at := now();
    when old.status in ('draft', 'open', 'closed') and new.status = 'cancelled' then
      new.cancelled_at := now();
    else
      raise exception 'A tender cannot move from % to %', old.status, new.status using errcode = 'check_violation';
  end case;
  return new;
end;
$$;

revoke all on function private.enforce_tender_lifecycle() from public, anon, authenticated;

create trigger enforce_tender_lifecycle
before insert or update on public.tenders
for each row execute function private.enforce_tender_lifecycle();

-- Drafts are private to their business; published tenders are public.
drop policy tenders_public_read on public.tenders;
create policy tenders_read_published on public.tenders
for select to anon, authenticated
using (status <> 'draft');
create policy tenders_read_own on public.tenders
for select to authenticated
using (business_id = (select auth.uid()));

-- Only drafts can be deleted; anything published stays on record.
drop policy business_delete_own_tenders on public.tenders;
create policy business_delete_own_draft_tenders on public.tenders
for delete to authenticated
using (business_id = (select auth.uid()) and status = 'draft');

create extension if not exists pg_cron with schema pg_catalog;

create function private.close_expired_tenders() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed_count integer;
begin
  update public.tenders set status = 'closed' where status = 'open' and closes_at <= now();
  get diagnostics closed_count = row_count;
  return closed_count;
end;
$$;

revoke all on function private.close_expired_tenders() from public, anon, authenticated;

select cron.schedule('close-expired-tenders', '* * * * *', 'select private.close_expired_tenders()');
