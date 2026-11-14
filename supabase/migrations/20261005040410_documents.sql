-- Tender and bid documents as write-once records (PRD section 7: tender_documents, bid_documents).
--
-- A tender or bid can now have several files. Rows are created only by security-definer functions:
-- publish_tender records a draft's files when it is published, and submit_bid records a bid's
-- files when it is submitted. After that, neither the rows nor the files can change (AUDIT.md H1/A4).
-- Each file's role says whether it is the requirements form, the proposal, or a supporting document.
--
-- The single document_path/document_name columns are copied into these tables and dropped. Existing
-- files keep their old storage paths ({user_id}/...); reads go through these rows, not the paths.

create type public.document_role as enum ('requirements_form', 'proposal', 'supporting');

create table public.tender_documents (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.tenders (id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  document_role public.document_role not null default 'supporting',
  uploaded_at timestamptz not null,
  constraint tender_documents_role_check check (document_role in ('requirements_form', 'supporting')),
  constraint tender_documents_size_check check (size_bytes between 0 and 10485760),
  constraint tender_documents_file_name_length check (char_length(file_name) between 1 and 255)
);

create index tender_documents_tender_id_idx on public.tender_documents (tender_id);

create table public.bid_documents (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bids (id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  document_role public.document_role not null default 'supporting',
  uploaded_at timestamptz not null,
  constraint bid_documents_role_check check (document_role in ('proposal', 'supporting')),
  constraint bid_documents_size_check check (size_bytes between 0 and 10485760),
  constraint bid_documents_file_name_length check (char_length(file_name) between 1 and 255)
);

create index bid_documents_bid_id_idx on public.bid_documents (bid_id);

comment on table public.tender_documents is 'Files of a published tender. Recorded by publish_tender; never changed or deleted.';
comment on table public.bid_documents is 'Files of a submitted bid. Recorded by submit_bid; never changed or deleted.';

-- Existing documents. Size and type come from Storage's own record of the file; a file missing
-- from Storage is still recorded, with size 0, so the bid or tender keeps its history.
insert into public.tender_documents (tender_id, storage_path, file_name, mime_type, size_bytes, document_role, uploaded_at)
select
  tender.id,
  tender.document_path,
  left(coalesce(nullif(btrim(tender.document_name), ''), regexp_replace(tender.document_path, '^.*/', '')), 255),
  coalesce(stored_object.metadata ->> 'mimetype', 'application/octet-stream'),
  coalesce((stored_object.metadata ->> 'size')::bigint, 0),
  'supporting',
  coalesce(stored_object.created_at, tender.created_at)
from public.tenders tender
left join storage.objects stored_object
  on stored_object.bucket_id = 'tender-documents' and stored_object.name = tender.document_path
where tender.document_path is not null;

-- The legacy site's one bid document was the proposal.
insert into public.bid_documents (bid_id, storage_path, file_name, mime_type, size_bytes, document_role, uploaded_at)
select
  bid.id,
  bid.document_path,
  left(coalesce(nullif(btrim(bid.document_name), ''), regexp_replace(bid.document_path, '^.*/', '')), 255),
  coalesce(stored_object.metadata ->> 'mimetype', 'application/octet-stream'),
  coalesce((stored_object.metadata ->> 'size')::bigint, 0),
  'proposal',
  coalesce(stored_object.created_at, bid.created_at)
from public.bids bid
left join storage.objects stored_object
  on stored_object.bucket_id = 'bid-documents' and stored_object.name = bid.document_path;

-- These two production policies read bids.document_path; the storage migration replaces every
-- storage policy, and the column can't be dropped while they exist.
drop policy "bid parties read bid files" on storage.objects;
drop policy ct_bid_docs_business_read on storage.objects;

alter table public.tenders drop column document_path, drop column document_name;
alter table public.bids drop column document_path, drop column document_name;

create trigger tender_documents_are_write_once
before update or delete on public.tender_documents
for each row execute function private.reject_change('Submitted documents cannot be changed or deleted.');
create trigger tender_documents_cannot_be_truncated
before truncate on public.tender_documents
for each statement execute function private.reject_change('Submitted documents cannot be changed or deleted.');

create trigger bid_documents_are_write_once
before update or delete on public.bid_documents
for each row execute function private.reject_change('Submitted documents cannot be changed or deleted.');
create trigger bid_documents_cannot_be_truncated
before truncate on public.bid_documents
for each statement execute function private.reject_change('Submitted documents cannot be changed or deleted.');

alter table public.tender_documents enable row level security;
alter table public.bid_documents enable row level security;

-- Runs under the tenders policies: published tenders, and the business's own drafts.
create policy tender_documents_read_visible on public.tender_documents
for select to authenticated
using (exists (select 1 from public.tenders tender where tender.id = tender_documents.tender_id));

-- Suppliers see the files of their own bids. Businesses see a closed tender's bid files only
-- through read_tender_bids, which logs the opening.
create policy bid_documents_read_own on public.bid_documents
for select to authenticated
using (exists (
  select 1 from public.bids bid
  where bid.id = bid_documents.bid_id and bid.supplier_id = (select auth.uid())
));

revoke all on public.tender_documents, public.bid_documents from public, anon, authenticated;
grant select on public.tender_documents, public.bid_documents to authenticated;
