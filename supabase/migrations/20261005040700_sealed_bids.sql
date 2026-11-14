-- A2: sealed bids (PRD P1-09; AUDIT.md issue 2).
--
-- Before closes_at nobody but the supplier who submitted a bid can read its amount, form or files:
-- not the business, not admins, and not even how many bids there are. Suppliers keep reading their
-- own bids directly (policy supplier_read_own_bids, from production).
--
-- From closes_at, the business that owns the tender reads every bid, with each supplier's name,
-- through read_tender_bids. There is no direct read policy for businesses, so every read goes
-- through that function, and its first call is logged as "bids opened". Bids on a tender cancelled
-- before its closing time are never opened.

drop policy business_read_tender_bids on public.bids;

-- Logs "bids opened" once per tender. The lock stops two first reads at the same moment logging twice.
create function private.record_bids_opened(opened_tender_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('bids_opened:' || opened_tender_id::text, 0));
  if not exists (
    select 1 from public.audit_log log
    where log.action = 'bids_opened' and log.entity_type = 'tender' and log.entity_id = opened_tender_id
  ) then
    perform private.write_audit_log('bids_opened', 'tender', opened_tender_id, jsonb_build_object(
      'bid_count', (select count(*) from public.bids bid where bid.tender_id = opened_tender_id)
    ));
  end if;
end;
$$;

-- Whether the tender's business may read its bids now: the deadline has passed and the tender
-- wasn't cancelled before it.
create function private.bids_are_open(checked_tender_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenders tender
    where tender.id = checked_tender_id
      and tender.status <> 'draft'
      and tender.closes_at <= clock_timestamp()
      and (tender.cancelled_at is null or tender.cancelled_at >= tender.closes_at)
  );
$$;

create function public.read_tender_bids(tender_id uuid)
returns table (
  bid_id uuid,
  supplier_id uuid,
  supplier_company_name text,
  amount numeric,
  currency text,
  submitted_at timestamptz,
  status public.bid_status,
  documents jsonb,
  proposal_form jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  caller_id uuid := private.require_active_user();
  tender_owner_id uuid;
  tender_closes_at timestamptz;
  tender_cancelled_at timestamptz;
begin
  select tender.business_id, tender.closes_at, tender.cancelled_at
  into tender_owner_id, tender_closes_at, tender_cancelled_at
  from public.tenders tender
  where tender.id = read_tender_bids.tender_id and tender.status <> 'draft';

  if not found or tender_owner_id <> caller_id then
    raise exception 'Tender not found.' using errcode = 'no_data_found';
  end if;
  if tender_cancelled_at is not null and tender_cancelled_at < tender_closes_at then
    raise exception 'This tender was cancelled before it closed, so its bids were never opened.'
      using errcode = 'insufficient_privilege';
  end if;
  if not private.bids_are_open(read_tender_bids.tender_id) then
    raise exception 'Bids are sealed until % Jamaica time.',
      to_char(tender_closes_at at time zone 'America/Jamaica', 'DD Mon YYYY HH24:MI')
      using errcode = 'insufficient_privilege';
  end if;

  perform private.record_bids_opened(read_tender_bids.tender_id);

  return query
  select
    bid.id,
    bid.supplier_id,
    company.company_name,
    bid.amount,
    bid.currency,
    bid.submitted_at,
    bid.status,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'document_id', document.id,
        'file_name', document.file_name,
        'mime_type', document.mime_type,
        'size_bytes', document.size_bytes,
        'document_role', document.document_role
      ) order by document.document_role, document.file_name)
      from public.bid_documents document
      where document.bid_id = bid.id
    ), '[]'::jsonb),
    (
      select jsonb_build_object('form_key', submission.form_key, 'form_version', submission.form_version, 'data', submission.data)
      from public.form_submissions submission
      where submission.attached_to_type = 'bid' and submission.attached_to_id = bid.id
    )
  from public.bids bid
  left join public.company_names company
    on company.user_id = bid.supplier_id and company.account_type = 'supplier'
  where bid.tender_id = read_tender_bids.tender_id
  order by bid.submitted_at;
end;
$$;

revoke all on function private.record_bids_opened(uuid) from public, anon, authenticated;
revoke all on function private.bids_are_open(uuid) from public, anon, authenticated;
revoke all on function public.read_tender_bids(uuid) from public, anon, authenticated;
grant execute on function public.read_tender_bids(uuid) to authenticated;
