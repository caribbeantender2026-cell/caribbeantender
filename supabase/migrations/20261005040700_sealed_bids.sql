-- Sealed bids: the tender's business can read bids only after the tender has been formally closed.
-- Suppliers only ever read their own (policy supplier_read_own_bids, unchanged). Supplier names
-- follow automatically, because company_names shows a supplier's name only to someone who can see
-- one of their bids.
--
-- The rule is "closed_at is set", not "closes_at has passed". closed_at is set only by the
-- open -> closed transition, which the lifecycle trigger allows only once closes_at has passed and
-- which the audit log records as the bid opening. So bids can never be read without the opening on
-- record. The scheduled job closes tenders within a minute, and the business can close its own
-- tender itself the moment the deadline passes. closed_at stays set if the tender is later awarded
-- or cancelled; a tender cancelled before closing never gets it, so its bids are never opened.

drop policy business_read_tender_bids on public.bids;

create policy bids_read_by_tender_owner_after_opening on public.bids
for select to authenticated
using (
  exists (
    select 1
    from public.tenders tender
    where tender.id = bids.tender_id
      and tender.business_id = (select auth.uid())
      and tender.closed_at is not null
      and tender.closes_at <= now()
  )
);
