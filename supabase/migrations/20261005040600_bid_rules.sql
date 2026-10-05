-- Bids: the database alone decides whether a bid is accepted, and a bid never changes afterwards.
--
-- The rules live in a trigger rather than in the INSERT policy so that a rejected bid gets a clear
-- reason ("This tender closed at ...") instead of a generic row-level security error. The policy
-- keeps the identity check: a supplier can only bid as themselves.

drop policy supplier_insert_bid on public.bids;
create policy bids_insert_own on public.bids
for insert to authenticated
with check (supplier_id = (select auth.uid()));

create function private.enforce_bid_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tender_status public.tender_status;
  tender_closes_at timestamptz;
  tender_business_id uuid;
  submitted_at timestamptz := clock_timestamp();
begin
  -- The share lock stops the tender being closed or cancelled between this check and the insert.
  select tender.status, tender.closes_at, tender.business_id
  into tender_status, tender_closes_at, tender_business_id
  from public.tenders tender
  where tender.id = new.tender_id
  for share;

  if not found then
    raise exception 'Tender not found' using errcode = 'foreign_key_violation';
  end if;
  if tender_status <> 'open' then
    raise exception 'This tender is not open for bids' using errcode = 'check_violation';
  end if;
  -- clock_timestamp, not now(): the deadline is checked at the moment of submission, not when the
  -- transaction began.
  if tender_closes_at <= submitted_at then
    raise exception 'This tender closed at %', tender_closes_at using errcode = 'check_violation';
  end if;
  if tender_business_id = new.supplier_id then
    raise exception 'A business cannot bid on its own tender' using errcode = 'check_violation';
  end if;
  if not private.supplier_has_access(new.supplier_id) then
    raise exception 'An active trial or subscription is required to submit a bid' using errcode = 'insufficient_privilege';
  end if;
  -- The proposal must already be uploaded by this supplier into their own folder (AUDIT.md M5).
  -- Together with the unique index below, a bid can never point at someone else's file or at a
  -- file uploaded after submission.
  if (storage.foldername(new.document_path))[1] is distinct from new.supplier_id::text
    or not exists (
      select 1
      from storage.objects stored_object
      where stored_object.bucket_id = 'bid-documents'
        and stored_object.name = new.document_path
        and stored_object.owner_id = new.supplier_id::text
    )
  then
    raise exception 'Upload the proposal document before submitting the bid' using errcode = 'check_violation';
  end if;

  -- The submission time is the database's, never the browser's.
  new.created_at := submitted_at;
  new.updated_at := submitted_at;
  return new;
end;
$$;

revoke all on function private.enforce_bid_rules() from public, anon, authenticated;

create trigger enforce_bid_rules
before insert on public.bids
for each row execute function private.enforce_bid_rules();

create unique index bids_document_path_key on public.bids (document_path);

-- Submitted bids are immutable for everyone, including the service role.
create function private.reject_bid_changes() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A submitted bid cannot be changed or deleted' using errcode = 'check_violation';
end;
$$;

revoke all on function private.reject_bid_changes() from public, anon, authenticated;

drop trigger bids_updated on public.bids;

create trigger bids_are_immutable
before update or delete on public.bids
for each row execute function private.reject_bid_changes();

create trigger bids_cannot_be_truncated
before truncate on public.bids
for each statement execute function private.reject_bid_changes();

-- Deleting a supplier profile must not delete their bids either.
alter table public.bids
  drop constraint bids_supplier_id_fkey,
  add constraint bids_supplier_id_fkey foreign key (supplier_id) references public.supplier_profiles (user_id) on delete restrict;
