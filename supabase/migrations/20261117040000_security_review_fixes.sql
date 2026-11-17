-- Security fixes from the 17 Nov 2026 review (decisions by Tevin, 2026-11-17).
--
-- 1. Sealed bids reach the audit log too (PRD P1-09 over P1-14): before a tender's bids open, admins
--    don't see its "bid submitted" entries, or the download entries of its bid files, whose paths
--    name the tender and the bid. Both show once the bids open; a tender cancelled before closing
--    never opens them, so they stay hidden, like the bids.
-- 2. Deactivated users can't change their profile, company details or tender alerts (Q21), even with
--    a token issued before the deactivation.
-- 3. Bid files allow 50 uploads per person per day (was 20): three bids with seven files each no
--    longer hit the limit. Tender files and account pictures stay at 20.
-- 4. A bid's online proposal must be the supplier proposal form, and a tender's attached form the
--    requirements form, not another form of the same audience (such as a registration form).

-- 1. Sealed bid entries in the audit log. The tender check is private.bids_are_open's rule, written
--    out here because a policy runs as the querying role and admins hold no grant on that function
--    (the M7 grant list). Admins read every non-draft tender, and bids only exist on those.
alter policy audit_log_read_admins on public.audit_log
using (
  (select private.caller_is_admin())
  and (
    not (action = 'bid_submitted' or (action = 'document_download_url_issued' and metadata ->> 'bucket' = 'bid-documents'))
    or exists (
      select 1 from public.tenders tender
      -- Bid file paths are <tender id>/<bid id>/...
      where tender.id = private.try_uuid(case when action = 'bid_submitted' then metadata ->> 'tender_id' else split_part(metadata ->> 'path', '/', 1) end)
        and tender.status <> 'draft'
        and tender.closes_at <= clock_timestamp()
        and (tender.cancelled_at is null or tender.cancelled_at >= tender.closes_at)
    )
  )
);

-- 2. Deactivated users can't write their own profile rows. The check is in WITH CHECK, so the app
--    gets an error instead of a silent "nothing changed".
alter policy profiles_update_own on public.profiles
with check ((select auth.uid()) = id and (select private.caller_is_active()));

alter policy business_profile_update_own on public.business_profiles
with check ((select auth.uid()) = user_id and (select private.caller_is_active()));

alter policy business_profile_insert_own on public.business_profiles
with check ((select auth.uid()) = user_id and (select private.caller_is_active()));

alter policy supplier_profile_update_own on public.supplier_profiles
with check ((select auth.uid()) = user_id and (select private.caller_is_active()));

alter policy supplier_profile_insert_own on public.supplier_profiles
with check ((select auth.uid()) = user_id and (select private.caller_is_active()));

alter policy notification_preferences_update_own on public.notification_preferences
with check (user_id = (select auth.uid()) and (select private.caller_is_active()));

alter policy notification_preferences_insert_own on public.notification_preferences
with check (user_id = (select auth.uid()) and (select private.caller_is_active()));

-- 3. 50 bid files a day.
alter policy bid_documents_upload_before_submission on storage.objects
with check (
  bucket_id = 'bid-documents'
  and private.bid_refusal_reason(private.try_uuid((storage.foldername(name))[1]), private.try_uuid((storage.foldername(name))[2])) is null
  and (
    cardinality(storage.foldername(name)) = 2
    or (cardinality(storage.foldername(name)) = 3 and (storage.foldername(name))[3] = 'proposal')
  )
  and (select private.uploads_in_last_day('bid-documents')) < 50
);

-- 4a. Only the requirements form can be attached to a tender.
alter policy form_submissions_insert_own on public.form_submissions
with check (
  owner_id = (select auth.uid())
  and (select private.caller_is_active())
  and exists (
    select 1 from public.form_definitions definition
    where definition.key = form_submissions.form_key
      and definition.version = form_submissions.form_version
      and definition.is_active
      and (
        (definition.audience = 'business' and exists (select 1 from public.business_profiles business where business.user_id = (select auth.uid())))
        or (definition.audience = 'supplier' and exists (select 1 from public.supplier_profiles supplier where supplier.user_id = (select auth.uid())))
      )
      and (
        form_submissions.attached_to_type is null
        or (
          form_submissions.attached_to_type = 'tender'
          and form_submissions.form_key = 'business-requirements'
          and exists (
            select 1 from public.tenders tender
            where tender.id = form_submissions.attached_to_id
              and tender.business_id = (select auth.uid())
              and tender.status = 'draft'
          )
        )
      )
  )
);

-- 4b. Only the supplier proposal form can be a bid's online proposal. Unchanged from the live
--     definition except for the form_key condition.
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
