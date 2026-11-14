-- A6: deadlines become an exact moment (closes_at timestamptz, stored in UTC) instead of a date
-- compared against the UTC date (AUDIT.md issue 7). The app shows them in America/Jamaica.
--
-- Existing tenders close at 23:59:59 Jamaica time on their closing date (PRD section 7), so none
-- closes earlier than users expected. Jamaica is UTC-5 all year, so that is 04:59:59 UTC next day.
--
-- This also removes CHECK (closing_date >= CURRENT_DATE), which re-ran on every update and made a
-- tender uneditable, even to cancel it, once its date had passed (AUDIT.md M1). The tender
-- lifecycle checks the deadline only when a tender is published or extended.

-- The CHECK goes first: it re-runs on every update, so filling closes_at below would fail for any
-- tender whose closing date has already passed.
alter table public.tenders drop constraint tenders_closing_date_check;

alter table public.tenders add column closes_at timestamptz;

-- A schema change isn't an edit by the business: updated_at keeps its value (the lifecycle
-- migration reads it as the cancellation time of cancelled tenders).
alter table public.tenders disable trigger tenders_updated;
update public.tenders
set closes_at = (closing_date + time '23:59:59') at time zone 'America/Jamaica';
alter table public.tenders enable trigger tenders_updated;

alter table public.tenders alter column closes_at set not null;

drop index public.tenders_open_idx;
alter table public.tenders drop column closing_date;

create index tenders_status_closes_at_idx on public.tenders (status, closes_at);

comment on column public.tenders.closes_at is
  'Exact closing moment, stored in UTC. Bids are accepted strictly before it and readable by the business from it. Shown in America/Jamaica.';
