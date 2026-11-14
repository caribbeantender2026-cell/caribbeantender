-- New tender states (PRD P1-07). Kept in a migration of its own because Postgres does not let a new
-- enum value be used in the same transaction that adds it, and each migration file runs as one.
alter type public.tender_status add value if not exists 'draft' before 'open';
alter type public.tender_status add value if not exists 'awarded' after 'closed';
