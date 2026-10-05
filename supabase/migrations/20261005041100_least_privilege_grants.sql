-- Least-privilege grants (AUDIT.md M6 and M7).
--
-- Until now anon and authenticated held every privilege on every table, so row-level security
-- was the only barrier, and Supabase's default privileges granted the same on any new table.
-- From here, each role gets exactly the tables and columns the app uses; RLS still decides rows.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

-- Visitors who are not signed in: the public tender list and plan prices.
grant select on public.tenders, public.subscription_plans, public.company_names, public.business_names_public to anon;

-- Signed-in users. Column lists leave out ids, ownership, timestamps and lifecycle fields.
grant select on
  public.profiles, public.business_profiles, public.supplier_profiles, public.tenders, public.bids,
  public.subscriptions, public.subscription_plans, public.subscription_events,
  public.company_names, public.business_names_public, public.supplier_names_public, public.audit_log
to authenticated;

grant update (full_name, phone, company_name, company_address, description, industry_category)
  on public.profiles to authenticated;

grant insert (user_id, company_name, company_address, phone, contact_email, description)
  on public.business_profiles to authenticated;
grant update (company_name, company_address, phone, contact_email, description)
  on public.business_profiles to authenticated;

grant insert (user_id, company_name, company_address, industry_category, phone, contact_email, description)
  on public.supplier_profiles to authenticated;
grant update (company_name, company_address, industry_category, phone, contact_email, description)
  on public.supplier_profiles to authenticated;

grant insert (business_id, title, description, closes_at, status, document_path, document_name)
  on public.tenders to authenticated;
grant update (title, description, closes_at, status, document_path, document_name, awarded_bid_id)
  on public.tenders to authenticated;
grant delete on public.tenders to authenticated;

grant insert (tender_id, supplier_id, amount, document_path, document_name)
  on public.bids to authenticated;

grant insert (event_type, actor_id, tender_id, bid_id, details)
  on public.audit_log to authenticated;

grant execute on function public.request_bid_document_download(uuid) to authenticated;
grant execute on function private.supplier_has_access(uuid) to authenticated;
grant execute on function private.uploads_in_last_day(text) to authenticated;

-- New objects get nothing by default; every grant is written in a migration.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
-- PUBLIC's EXECUTE on new functions is a global default, so it can only be revoked globally.
alter default privileges for role postgres revoke execute on functions from public;
