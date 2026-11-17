-- The online Bid Submission Form repeats the bid amount as "Total bid value (JMD)". When a supplier
-- fills the form in on the site, the two must be the same (Rockell, 17 Nov 2026). An uploaded
-- proposal file can't be read, so it has no total to check. The form's older draft version has no
-- such field, so it isn't checked either. Otherwise unchanged from 20261117040000.
create or replace function public.submit_bid(tender_id uuid, bid_id uuid, amount numeric, proposal_form_submission_id uuid default null)
returns timestamptz
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
      and submission.form_key = 'supplier-proposal'
    for update of submission;
    if not found then
      raise exception 'Proposal form not found, or it is already attached to a bid.' using errcode = 'no_data_found';
    end if;
    problems := private.form_data_problems(proposal_schema, proposal_data, true);
    if cardinality(problems) > 0 then
      raise exception 'The proposal form is not complete. %', array_to_string(problems, ' ') using errcode = 'check_violation';
    end if;
    if jsonb_typeof(proposal_data -> 'total_bid_value') = 'number'
       and (proposal_data ->> 'total_bid_value')::numeric <> submit_bid.amount then
      raise exception 'The total bid value in your proposal form (JMD %) must match your bid amount (JMD %). Change one so they match.',
        to_char((proposal_data ->> 'total_bid_value')::numeric, 'FM999,999,999,990.00'), to_char(submit_bid.amount, 'FM999,999,999,990.00')
        using errcode = 'check_violation';
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
