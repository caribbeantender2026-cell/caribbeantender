-- Storage rules matching the tender and bid rules (PRD 8.5; AUDIT.md H1/A4, issue 6/A5, M3, M4, M5).
--
-- Paths are namespaced by tender and bid (OPEN_QUESTIONS.md, item 11):
--   tender-documents/{tender_id}/{file}                     a draft's supporting documents
--   tender-documents/{tender_id}/requirements-form/{file}   a draft's uploaded requirements form
--   bid-documents/{tender_id}/{bid_id}/{file}               a bid's supporting documents
--   bid-documents/{tender_id}/{bid_id}/proposal/{file}      a bid's uploaded proposal
--
-- Uploads: only into your own draft's folder, or into the folder of a bid you haven't submitted yet,
-- on an open tender you may bid on. Bid uploads use the same rule function as submit_bid
-- (private.bid_refusal_reason), so the two can never drift apart. Once a bid exists, nothing more can
-- be uploaded to its folder.
-- At most 20 uploads per person per day, per bucket.
--
-- Write-once: nobody updates or deletes a file once its draft is published or its bid submitted.
-- Before that, the uploader may remove their own file.
--
-- Downloads: users get no read access to published tender files or submitted bid files at all.
-- request_document_download checks the rules and logs the request; an Edge Function then signs a
-- URL valid for 60 seconds (Stage 2). That keeps every download logged and every link short-lived,
-- which a browser-chosen signed-URL lifetime could not guarantee.
--
-- Excel: .xls and .xlsx are allowed on both buckets, as PRD 8.5 requires.

drop policy if exists "authenticated users read tender files" on storage.objects;
drop policy if exists "bid parties read bid files" on storage.objects;
drop policy if exists "business manages own tender files" on storage.objects;
drop policy if exists "business uploads own tender files" on storage.objects;
drop policy if exists ct_bid_docs_business_read on storage.objects;
drop policy if exists ct_bid_docs_insert on storage.objects;
drop policy if exists ct_bid_docs_supplier_read on storage.objects;
drop policy if exists ct_tender_docs_insert on storage.objects;
drop policy if exists ct_tender_docs_read on storage.objects;
drop policy if exists "supplier manages own bid files" on storage.objects;
drop policy if exists "supplier uploads own bid files" on storage.objects;

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
where id in ('bid-documents', 'tender-documents');

-- Printable copies of the standard forms (PRD P1-11). Written only by staff through the dashboard.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'form-templates', 'form-templates', false, 10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

-- Security definer so the count sees all of the caller's files without a read policy on them.
create function private.uploads_in_last_day(bucket_name text) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from storage.objects stored_object
  where stored_object.bucket_id = bucket_name
    and stored_object.owner_id = (select auth.uid())::text
    and stored_object.created_at > now() - interval '1 day';
$$;

-- Whether a tender folder belongs to one of the caller's drafts.
create function private.is_own_draft_tender_folder(tender_folder text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenders tender
    where tender.id = private.try_uuid(tender_folder)
      and tender.business_id = (select auth.uid())
      and tender.status = 'draft'
  );
$$;

-- Whether a bid folder is the caller's and its bid hasn't been submitted (files can still be removed).
create function private.is_own_unsubmitted_bid_folder(bid_folder text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.try_uuid(bid_folder) is not null
    and not exists (select 1 from public.bids bid where bid.id = private.try_uuid(bid_folder));
$$;

create policy tender_documents_upload_to_own_draft on storage.objects
for insert to authenticated
with check (
  bucket_id = 'tender-documents'
  and (select private.caller_is_active())
  and private.is_own_draft_tender_folder((storage.foldername(name))[1])
  and (
    cardinality(storage.foldername(name)) = 1
    or (cardinality(storage.foldername(name)) = 2 and (storage.foldername(name))[2] = 'requirements-form')
  )
  and (select private.uploads_in_last_day('tender-documents')) < 20
);

create policy tender_documents_manage_own_draft on storage.objects
for select to authenticated
using (
  bucket_id = 'tender-documents'
  and owner_id = (select auth.uid())::text
  and private.is_own_draft_tender_folder((storage.foldername(name))[1])
);

create policy tender_documents_remove_from_own_draft on storage.objects
for delete to authenticated
using (
  bucket_id = 'tender-documents'
  and owner_id = (select auth.uid())::text
  and private.is_own_draft_tender_folder((storage.foldername(name))[1])
);

create policy bid_documents_upload_before_submission on storage.objects
for insert to authenticated
with check (
  bucket_id = 'bid-documents'
  and private.bid_refusal_reason(private.try_uuid((storage.foldername(name))[1]), private.try_uuid((storage.foldername(name))[2])) is null
  and (
    cardinality(storage.foldername(name)) = 2
    or (cardinality(storage.foldername(name)) = 3 and (storage.foldername(name))[3] = 'proposal')
  )
  and (select private.uploads_in_last_day('bid-documents')) < 20
);

create policy bid_documents_manage_own_before_submission on storage.objects
for select to authenticated
using (
  bucket_id = 'bid-documents'
  and owner_id = (select auth.uid())::text
  and private.is_own_unsubmitted_bid_folder((storage.foldername(name))[2])
);

create policy bid_documents_remove_own_before_submission on storage.objects
for delete to authenticated
using (
  bucket_id = 'bid-documents'
  and owner_id = (select auth.uid())::text
  and private.is_own_unsubmitted_bid_folder((storage.foldername(name))[2])
);

create policy form_templates_read_signed_in on storage.objects
for select to authenticated
using (bucket_id = 'form-templates');

-- Checks whether the caller may download a document, logs the request, and returns where it is.
-- Tender documents: any signed-in user for a published tender. Bid documents: the supplier who
-- submitted the bid, or the tender's business once the bids are open. Admins: no bid documents in
-- Phase 1 (OPEN_QUESTIONS.md, item 19). The Edge Function signs the URL for 60 seconds.
create function public.request_document_download(document_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_active_user();
  found_bucket text;
  found_path text;
  found_file_name text;
  bid_supplier_id uuid;
  bid_tender_id uuid;
  tender_owner_id uuid;
  tender_status public.tender_status;
  allowed boolean := false;
begin
  select 'tender-documents', document.storage_path, document.file_name, tender.business_id, tender.status
  into found_bucket, found_path, found_file_name, tender_owner_id, tender_status
  from public.tender_documents document
  join public.tenders tender on tender.id = document.tender_id
  where document.id = request_document_download.document_id;

  if found then
    allowed := tender_status <> 'draft' or tender_owner_id = caller_id;
  else
    select 'bid-documents', document.storage_path, document.file_name, bid.supplier_id, bid.tender_id, tender.business_id
    into found_bucket, found_path, found_file_name, bid_supplier_id, bid_tender_id, tender_owner_id
    from public.bid_documents document
    join public.bids bid on bid.id = document.bid_id
    join public.tenders tender on tender.id = bid.tender_id
    where document.id = request_document_download.document_id;

    if found then
      if bid_supplier_id = caller_id then
        allowed := true;
      elsif tender_owner_id = caller_id and private.bids_are_open(bid_tender_id) then
        allowed := true;
        -- A business reaching a bid file is an opening, even if it never listed the bids.
        perform private.record_bids_opened(bid_tender_id);
      end if;
    end if;
  end if;

  -- One message for "missing" and "not yours", so ids can't be probed.
  if not allowed then
    raise exception 'Document not found.' using errcode = 'no_data_found';
  end if;

  perform private.write_audit_log('document_download_url_issued', 'document', request_document_download.document_id,
    jsonb_build_object('bucket', found_bucket, 'path', found_path));

  return jsonb_build_object('bucket', found_bucket, 'path', found_path, 'file_name', found_file_name);
end;
$$;

revoke all on function private.uploads_in_last_day(text) from public, anon, authenticated;
revoke all on function private.is_own_draft_tender_folder(text) from public, anon, authenticated;
revoke all on function private.is_own_unsubmitted_bid_folder(text) from public, anon, authenticated;
revoke all on function public.request_document_download(uuid) from public, anon, authenticated;
grant execute on function private.uploads_in_last_day(text) to authenticated;
grant execute on function private.is_own_draft_tender_folder(text) to authenticated;
grant execute on function private.try_uuid(text) to authenticated;
grant execute on function private.is_own_unsubmitted_bid_folder(text) to authenticated;
grant execute on function public.request_document_download(uuid) to authenticated;
