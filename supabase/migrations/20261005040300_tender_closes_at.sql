-- Deadlines become an exact moment (closes_at timestamptz, stored in UTC) instead of a date.
-- The app displays them in America/Jamaica.
--
-- Existing tenders: a closing date meant "open until the end of that day". Jamaica is UTC-5 with
-- no daylight saving, so the end of the day is midnight local time, i.e. 05:00 UTC the next day.
--
-- This also removes CHECK (closing_date >= CURRENT_DATE), which re-ran on every update and made a
-- tender uneditable (even to cancel it) once its date had passed (AUDIT.md M1). The tender
-- lifecycle migration validates deadlines only when a tender is published.

-- The CHECK goes first: it re-runs on every update, so filling closes_at below would fail for any
-- tender whose closing date has already passed.
alter table public.tenders drop constraint tenders_closing_date_check;

alter table public.tenders add column closes_at timestamptz;

-- A schema change is not an edit by the business: updated_at keeps its value (the lifecycle
-- migration reads it as the cancellation time of cancelled tenders).
alter table public.tenders disable trigger tenders_updated;
update public.tenders
set closes_at = (closing_date + 1)::timestamp at time zone 'America/Jamaica';
alter table public.tenders enable trigger tenders_updated;

alter table public.tenders alter column closes_at set not null;

alter table public.tenders drop column closing_date;

create index tenders_status_closes_at_idx on public.tenders (status, closes_at);

comment on column public.tenders.closes_at is
  'Exact closing moment, stored in UTC. Bids are accepted strictly before it and unsealed at it. Displayed in America/Jamaica.';
