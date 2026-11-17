-- The Supabase performance advisor's findings on 2026-11-17.
--
-- tenders and form_submissions each had two read policies for signed-in users, and Postgres runs every
-- permissive policy for every row it checks. Each pair becomes one policy with the same meaning:
-- permissive policies already combine with OR. Existing suites prove the behaviour is unchanged.
--
-- Two foreign keys had no index, so checking them scanned the whole referencing table.

drop policy tenders_read_published on public.tenders;
drop policy tenders_read_own on public.tenders;

create policy tenders_read_published_or_own on public.tenders
for select to authenticated
using (status <> 'draft' or business_id = (select auth.uid()));

drop policy form_submissions_read_own on public.form_submissions;
drop policy form_submissions_read_tender_forms on public.form_submissions;

-- A published tender's requirements form is readable by everyone who can see the tender.
create policy form_submissions_read_own_or_tender_forms on public.form_submissions
for select to authenticated
using (
  owner_id = (select auth.uid())
  or (
    attached_to_type = 'tender'
    and exists (select 1 from public.tenders tender where tender.id = form_submissions.attached_to_id)
  )
);

create index form_submissions_form_definition_idx on public.form_submissions (form_key, form_version);
create index tenders_awarded_bid_idx on public.tenders (awarded_bid_id, id);
