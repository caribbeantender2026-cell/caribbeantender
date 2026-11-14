-- Bids (PRD P1-08; AUDIT.md issue 3 / A3).
--
-- A bid is submitted only through submit_bid, a security-definer function (PRD 8.3). It accepts a
-- bid only when the supplier is active and has an active trial or subscription, the tender is open,
-- and the database clock is before closes_at. It sets submitted_at itself. Nobody can insert,
-- change or delete a bid directly. The only later change is the bid's outcome, set by award_tender
-- or cancel_tender, and a trigger checks that outcome against the tender.
--
-- Files: the supplier uploads into bid-documents/{tender_id}/{bid_id}/ (the proposal file, if any,
-- under proposal/) before submitting, choosing the bid id in the browser. submit_bid checks that
-- every file under that path was uploaded by the caller, then records them. Storage refuses any
-- upload to a bid's path once the bid exists (storage policies migration).

create type public.bid_status as enum ('submitted', 'awarded', 'unsuccessful', 'tender_cancelled');

alter table public.bids
  add column currency text not null default 'JMD',
  add column submitted_at timestamptz,
  add column status public.bid_status not null default 'submitted',
  -- Multiple currencies are out of scope (PRD section 3).
  add constraint bids_currency_is_jmd check (currency = 'JMD');

-- Existing bids: the submission time is when the row was created; bids on cancelled tenders get
-- that outcome. A schema change isn't an edit, so updated_at keeps its value.
alter table public.bids disable trigger bids_updated;
update public.bids bid
set
  submitted_at = bid.created_at,
  status = case when tender.status = 'cancelled' then 'tender_cancelled'::public.bid_status else 'submitted'::public.bid_status end
from public.tenders tender
where tender.id = bid.tender_id;
alter table public.bids enable trigger bids_updated;

alter table public.bids alter column submitted_at set not null;

-- Duplicate of the unique constraint bids_tender_id_supplier_id_key (AUDIT.md cleanup).
drop index public.bids_one_per_supplier_per_tender;

-- Deleting a supplier profile must not delete their bids.
alter table public.bids
  drop constraint bids_supplier_id_fkey,
  add constraint bids_supplier_id_fkey foreign key (supplier_id) references public.supplier_profiles (user_id) on delete restrict;

-- Direct inserts are replaced by submit_bid. The access rule moves to a full-word parameter name,
-- which needs the old policy (its only dependant) gone first.
drop policy supplier_insert_bid on public.bids;
drop function private.supplier_has_access(uuid);

create function private.supplier_has_access(supplier_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions subscription
    where subscription.supplier_id = supplier_user_id
      and (
        (subscription.status = 'trial' and subscription.trial_ends_at > now())
        or (subscription.status = 'active' and (subscription.current_period_end is null or subscription.current_period_end > now()))
      )
  );
$$;

-- A submitted bid never changes, for anyone, including the service role. The only exception is its
-- outcome, which must match what the tender records.
create function private.guard_bid_changes() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  tender_status public.tender_status;
  tender_awarded_bid_id uuid;
begin
  if tg_op <> 'UPDATE' then
    raise exception 'A submitted bid cannot be deleted.' using errcode = 'check_violation';
  end if;
  if (new.id, new.tender_id, new.supplier_id, new.amount, new.currency, new.submitted_at, new.created_at)
     is distinct from (old.id, old.tender_id, old.supplier_id, old.amount, old.currency, old.submitted_at, old.created_at) then
    raise exception 'A submitted bid cannot be changed.' using errcode = 'check_violation';
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;
  if old.status <> 'submitted' then
    raise exception 'This bid''s outcome is already %.', old.status using errcode = 'check_violation';
  end if;

  select tender.status, tender.awarded_bid_id into tender_status, tender_awarded_bid_id
  from public.tenders tender where tender.id = new.tender_id;

  if (new.status = 'awarded' and tender_status = 'awarded' and tender_awarded_bid_id = new.id)
     or (new.status = 'unsuccessful' and tender_status = 'awarded' and tender_awarded_bid_id <> new.id)
     or (new.status = 'tender_cancelled' and tender_status = 'cancelled') then
    return new;
  end if;
  raise exception 'A bid''s outcome must match its tender.' using errcode = 'check_violation';
end;
$$;

create trigger bids_are_immutable
before update or delete on public.bids
for each row execute function private.guard_bid_changes();

create trigger bids_cannot_be_truncated
before truncate on public.bids
for each statement execute function private.guard_bid_changes();

-- The bidding rules, in one place: submit_bid and the bid-documents upload policy both call this, so
-- a rule can never apply to one and not the other (OPEN_QUESTIONS.md, Part B decision 2). Returns why
-- the signed-in caller may not bid (or upload) for this bid on this tender, or null when they may.
create function private.bid_refusal_reason(tender_id uuid, bid_id uuid) returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  tender_status public.tender_status;
  tender_closes_at timestamptz;
  tender_business_id uuid;
begin
  if caller_id is null then
    return 'Sign in to do this.';
  end if;
  if not private.caller_is_active() then
    return 'This account has been deactivated. Contact CaribbeanTender for help.';
  end if;
  if bid_refusal_reason.bid_id is null then
    return 'A bid reference is required.';
  end if;
  if not exists (select 1 from public.supplier_profiles supplier where supplier.user_id = caller_id) then
    return 'Create a supplier account before bidding.';
  end if;

  select tender.status, tender.closes_at, tender.business_id
  into tender_status, tender_closes_at, tender_business_id
  from public.tenders tender where tender.id = bid_refusal_reason.tender_id;
  if not found then
    return 'Tender not found.';
  end if;
  if tender_status <> 'open' then
    return 'This tender is not open for bids.';
  end if;
  -- clock_timestamp, not now(): the deadline is checked at the moment of the request.
  if tender_closes_at <= clock_timestamp() then
    return format('This tender closed at %s Jamaica time.', to_char(tender_closes_at at time zone 'America/Jamaica', 'DD Mon YYYY HH24:MI:SS'));
  end if;
  if tender_business_id = caller_id then
    return 'A business cannot bid on its own tender.';
  end if;
  if not private.supplier_has_access(caller_id) then
    return 'Your free trial has ended, so you cannot submit bids. Contact CaribbeanTender to continue.';
  end if;
  if exists (select 1 from public.bids bid where bid.tender_id = bid_refusal_reason.tender_id and bid.supplier_id = caller_id) then
    return 'You have already submitted a bid for this tender. Bids cannot be changed.';
  end if;
  if exists (select 1 from public.bids bid where bid.id = bid_refusal_reason.bid_id) then
    return 'This bid reference is already used. Reload the page and try again.';
  end if;
  return null;
end;
$function$;

-- Submits a sealed bid and returns the exact submission time (PRD P1-08). The proposal is either a
-- filled-in supplier form (proposal_form_submission_id) or a file under the bid's proposal/ folder.
create function public.submit_bid(
  tender_id uuid,
  bid_id uuid,
  amount numeric,
  proposal_form_submission_id uuid default null
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  maximum_amount constant numeric := 1000000000000;
  caller_id uuid := private.require_active_user();
  submission_moment timestamptz := clock_timestamp();
  bid_folder text := submit_bid.tender_id::text || '/' || submit_bid.bid_id::text || '/';
  proposal_folder text := submit_bid.tender_id::text || '/' || submit_bid.bid_id::text || '/proposal/';
  refusal text;
  stored_file record;
  has_proposal_file boolean := false;
  proposal_schema jsonb;
  proposal_data jsonb;
  problems text[];
begin
  if submit_bid.amount is null or submit_bid.amount <= 0 or submit_bid.amount >= maximum_amount
     or submit_bid.amount <> round(submit_bid.amount, 2) then
    raise exception 'Enter a bid amount above zero, with at most two decimal places.' using errcode = 'check_violation';
  end if;

  -- The share lock stops the tender being closed or cancelled between the rule check and the insert.
  perform 1 from public.tenders tender where tender.id = submit_bid.tender_id for share;

  refusal := private.bid_refusal_reason(submit_bid.tender_id, submit_bid.bid_id);
  if refusal is not null then
    raise exception '%', refusal using errcode = 'check_violation';
  end if;

  insert into public.bids (id, tender_id, supplier_id, amount, currency, submitted_at, status, created_at, updated_at)
  values (submit_bid.bid_id, submit_bid.tender_id, caller_id, submit_bid.amount, 'JMD', submission_moment, 'submitted', submission_moment, submission_moment);

  -- Every file in the bid's folder must be the caller's own upload (OPEN_QUESTIONS.md, item 11).
  for stored_file in
    select stored_object.name, stored_object.owner_id, stored_object.metadata, stored_object.created_at
    from storage.objects stored_object
    where stored_object.bucket_id = 'bid-documents' and starts_with(stored_object.name, bid_folder)
    order by stored_object.name
  loop
    if stored_file.owner_id is distinct from caller_id::text then
      raise exception 'A file in this bid''s folder was not uploaded by you (%). Remove it and submit again.', stored_file.name
        using errcode = 'insufficient_privilege';
    end if;
    insert into public.bid_documents (bid_id, storage_path, file_name, mime_type, size_bytes, document_role, uploaded_at)
    values (
      submit_bid.bid_id,
      stored_file.name,
      left(regexp_replace(stored_file.name, '^.*/', ''), 255),
      coalesce(stored_file.metadata ->> 'mimetype', 'application/octet-stream'),
      coalesce((stored_file.metadata ->> 'size')::bigint, 0),
      case when starts_with(stored_file.name, proposal_folder) then 'proposal' else 'supporting' end::public.document_role,
      stored_file.created_at
    );
    has_proposal_file := has_proposal_file or starts_with(stored_file.name, proposal_folder);
  end loop;

  if submit_bid.proposal_form_submission_id is not null then
    select definition.schema, submission.data into proposal_schema, proposal_data
    from public.form_submissions submission
    join public.form_definitions definition
      on definition.key = submission.form_key and definition.version = submission.form_version
    where submission.id = submit_bid.proposal_form_submission_id
      and submission.owner_id = caller_id
      and submission.attached_to_type is null
      and definition.audience = 'supplier'
    for update of submission;
    if not found then
      raise exception 'Proposal form not found, or it is already attached to a bid.' using errcode = 'no_data_found';
    end if;
    problems := private.form_data_problems(proposal_schema, proposal_data, true);
    if cardinality(problems) > 0 then
      raise exception 'The proposal form is not complete. %', array_to_string(problems, ' ') using errcode = 'check_violation';
    end if;
    update public.form_submissions submission
    set attached_to_type = 'bid', attached_to_id = submit_bid.bid_id
    where submission.id = submit_bid.proposal_form_submission_id;
  elsif not has_proposal_file then
    raise exception 'Fill in the proposal form online, or upload your proposal, before submitting.' using errcode = 'check_violation';
  end if;

  perform private.write_audit_log('bid_submitted', 'bid', submit_bid.bid_id, jsonb_build_object(
    'tender_id', submit_bid.tender_id,
    'submitted_at', submission_moment,
    'document_count', (select count(*) from public.bid_documents document where document.bid_id = submit_bid.bid_id),
    'online_proposal_form', submit_bid.proposal_form_submission_id is not null
  ));

  return submission_moment;
end;
$$;

-- Shared by cancel_tender and the admin cancel. Bids get the outcome tender_cancelled, never
-- unsuccessful (OPEN_QUESTIONS.md, item 8).
create function private.cancel_tender_now(cancelled_tender_id uuid, cancellation_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.tender_status;
begin
  if cancellation_reason is null or char_length(btrim(cancellation_reason)) not between 1 and 1000 then
    raise exception 'Give a reason for cancelling, up to 1,000 characters.' using errcode = 'check_violation';
  end if;
  select tender.status into current_status from public.tenders tender where tender.id = cancelled_tender_id for update;
  if not found then
    raise exception 'Tender not found.' using errcode = 'no_data_found';
  end if;
  if current_status = 'draft' then
    raise exception 'A draft is deleted, not cancelled.' using errcode = 'check_violation';
  end if;
  if current_status not in ('open', 'closed') then
    raise exception 'A % tender cannot be cancelled.', current_status using errcode = 'check_violation';
  end if;

  update public.tenders tender
  set status = 'cancelled', cancelled_reason = btrim(cancellation_reason)
  where tender.id = cancelled_tender_id;

  update public.bids bid set status = 'tender_cancelled'
  where bid.tender_id = cancelled_tender_id and bid.status = 'submitted';
end;
$$;

create function public.cancel_tender(tender_id uuid, reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_active_user();
begin
  if not exists (select 1 from public.tenders tender where tender.id = cancel_tender.tender_id and tender.business_id = caller_id) then
    raise exception 'Tender not found.' using errcode = 'no_data_found';
  end if;
  perform private.cancel_tender_now(cancel_tender.tender_id, cancel_tender.reason);
end;
$$;

-- Awards one bid once the tender has closed; every other bid becomes unsuccessful (OPEN_QUESTIONS.md, item 8).
create function public.award_tender(tender_id uuid, bid_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_active_user();
  tender_owner_id uuid;
  current_status public.tender_status;
begin
  select tender.business_id, tender.status into tender_owner_id, current_status
  from public.tenders tender where tender.id = award_tender.tender_id for update;
  if not found or tender_owner_id <> caller_id then
    raise exception 'Tender not found.' using errcode = 'no_data_found';
  end if;
  if current_status <> 'closed' then
    raise exception 'A tender can be awarded once it has closed.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.bids bid where bid.id = award_tender.bid_id and bid.tender_id = award_tender.tender_id) then
    raise exception 'That bid is not on this tender.' using errcode = 'no_data_found';
  end if;

  update public.tenders tender set status = 'awarded', awarded_bid_id = award_tender.bid_id
  where tender.id = award_tender.tender_id;

  update public.bids bid
  set status = case when bid.id = award_tender.bid_id then 'awarded'::public.bid_status else 'unsuccessful'::public.bid_status end
  where bid.tender_id = award_tender.tender_id and bid.status = 'submitted';
end;
$$;

revoke insert, update, delete, truncate on public.bids from anon, authenticated;

revoke all on function private.supplier_has_access(uuid) from public, anon, authenticated;
revoke all on function private.bid_refusal_reason(uuid, uuid) from public, anon, authenticated;
-- The upload policy calls it as the querying role.
grant execute on function private.bid_refusal_reason(uuid, uuid) to authenticated;
revoke all on function private.guard_bid_changes() from public, anon, authenticated;
revoke all on function private.cancel_tender_now(uuid, text) from public, anon, authenticated;
revoke all on function public.submit_bid(uuid, uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public.cancel_tender(uuid, text) from public, anon, authenticated;
revoke all on function public.award_tender(uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_bid(uuid, uuid, numeric, uuid) to authenticated;
grant execute on function public.cancel_tender(uuid, text) to authenticated;
grant execute on function public.award_tender(uuid, uuid) to authenticated;
