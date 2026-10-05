-- Sealed bids: the tender's business can read bids only once closes_at has passed. Suppliers only
-- ever read their own (policy supplier_read_own_bids, unchanged). Supplier names follow
-- automatically, because company_names shows a supplier's name only to someone who can see one of
-- their bids.

drop policy business_read_tender_bids on public.bids;

create policy bids_read_by_tender_owner_after_closing on public.bids
for select to authenticated
using (
  exists (
    select 1
    from public.tenders tender
    where tender.id = bids.tender_id
      and tender.business_id = (select auth.uid())
      and tender.closes_at <= now()
      -- A tender cancelled before its deadline is never opened.
      and (tender.cancelled_at is null or tender.cancelled_at >= tender.closes_at)
  )
);
