-- Storage rules matching the bid rules and sealed bids.
--
-- Bid documents:
--   * upload only into your own folder, and only with an active trial or subscription;
--   * never updated or deleted, so the file behind a submitted bid cannot be swapped (AUDIT.md H1);
--   * read only after recording the download in the audit log, which itself is allowed only for
--     a bid the reader can see. So the seal and the audit trail apply to files as well as rows.
-- Tender documents:
--   * signed-in users only (AUDIT.md M3), and only for tenders they can see (no one else's drafts);
--   * never updated or deleted once uploaded.
-- Both buckets: at most 20 uploads per person per day (AUDIT.md M4).
--
-- Excel: .xlsx is now allowed, because suppliers price bids in spreadsheets and the form already
-- offered Excel. Legacy .xls is not: old binary Office formats can carry macros. (.doc has the same
-- risk and stays allowed for now; dropping it is a product decision.)

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
set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
where id in ('bid-documents', 'tender-documents');

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

revoke all on function private.uploads_in_last_day(text) from public, anon, authenticated;
grant execute on function private.uploads_in_last_day(text) to authenticated;

create policy bid_documents_upload_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'bid-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.supplier_has_access((select auth.uid())))
  and (select private.uploads_in_last_day('bid-documents')) < 20
);

create policy bid_documents_read_after_recorded_download on storage.objects
for select to authenticated
using (
  bucket_id = 'bid-documents'
  and exists (
    select 1
    from public.audit_log download
    where download.event_type = 'bid_document_download'
      and download.actor_id = (select auth.uid())
      and download.details ->> 'document_path' = objects.name
      and download.occurred_at > now() - interval '5 minutes'
  )
);

create policy tender_documents_upload_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'tender-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.business_profiles business where business.user_id = (select auth.uid()))
  and (select private.uploads_in_last_day('tender-documents')) < 20
);

-- The tenders subquery runs under the tenders policies: published tenders, plus your own drafts.
-- The file must also sit in that tender's business's own folder. A business can type any path into
-- its own tender's document_path, so without this it could point a tender at another business's
-- unpublished file and read it, or publish it to everyone.
create policy tender_documents_read on storage.objects
for select to authenticated
using (
  bucket_id = 'tender-documents'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.tenders tender
      where tender.document_path = objects.name
        and (storage.foldername(objects.name))[1] = tender.business_id::text
    )
  )
);

-- One call for the app: record the download, then return the path to sign. It runs as the caller,
-- so the bids policies decide whether the bid is visible; nothing here restates those rules.
create function public.request_bid_document_download(requested_bid_id uuid) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  visible_tender_id uuid;
  visible_document_path text;
begin
  select bid.tender_id, bid.document_path
  into visible_tender_id, visible_document_path
  from public.bids bid
  where bid.id = requested_bid_id;

  if not found then
    raise exception 'Bid document not available' using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_log (event_type, actor_id, tender_id, bid_id, details)
  values (
    'bid_document_download',
    (select auth.uid()),
    visible_tender_id,
    requested_bid_id,
    jsonb_build_object('document_path', visible_document_path)
  );

  return visible_document_path;
end;
$$;

revoke all on function public.request_bid_document_download(uuid) from public, anon, authenticated;
grant execute on function public.request_bid_document_download(uuid) to authenticated;
