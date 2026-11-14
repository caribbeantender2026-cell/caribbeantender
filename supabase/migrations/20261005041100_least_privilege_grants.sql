-- Least-privilege grants, final word on who may touch what (AUDIT.md M6/M7; PRD 8.1, 8.2, 8.4).
--
-- Production granted anon and authenticated every privilege on every table, so row-level security
-- was the only barrier, and its default privileges granted the same on any new table. From here:
--   * anon (visitors who are not signed in) gets nothing in the database. Every tender page needs an
--     account; the home and information pages are static.
--   * authenticated gets exactly the tables, columns and functions the app uses; RLS then decides rows.
--   * nobody but the owner holds TRUNCATE, REFERENCES, TRIGGER or MAINTAIN.
--   * new objects get nothing by default; every grant is written in a migration.

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Reads. Row-level security narrows each to what the caller may see.
grant select on
  public.profiles,
  public.business_profiles,
  public.supplier_profiles,
  public.company_names,
  public.business_names_public,
  public.supplier_names_public,
  public.categories,
  public.tenders,
  public.tender_documents,
  public.bids,
  public.bid_documents,
  public.form_definitions,
  public.form_submissions,
  public.subscriptions,
  public.notification_preferences,
  public.staff_members,
  public.audit_log
to authenticated;

-- Profile fields people edit. Ids, account type, activity, terms and onboarding are set elsewhere.
grant update (full_name, phone, company_name, company_address, description, industry_category)
  on public.profiles to authenticated;

grant insert (user_id, company_name, company_address, phone, contact_email, description)
  on public.business_profiles to authenticated;
grant update (company_name, company_address, phone, contact_email, description)
  on public.business_profiles to authenticated;

grant insert (user_id, company_name, company_address, industry_category, category_id, phone, contact_email, description)
  on public.supplier_profiles to authenticated;
grant update (company_name, company_address, industry_category, category_id, phone, contact_email, description)
  on public.supplier_profiles to authenticated;

-- Drafts only (row-level security). Status and lifecycle fields change only through the functions.
grant insert (business_id, title, description, category_id, closes_at) on public.tenders to authenticated;
grant update (title, description, category_id, closes_at) on public.tenders to authenticated;
grant delete on public.tenders to authenticated;

grant insert (form_key, form_version, owner_id, data, attached_to_type, attached_to_id) on public.form_submissions to authenticated;
grant update (data) on public.form_submissions to authenticated;
grant delete on public.form_submissions to authenticated;

grant insert (user_id, tender_alerts) on public.notification_preferences to authenticated;
grant update (tender_alerts) on public.notification_preferences to authenticated;

-- The app's remote procedures. Each checks the caller itself.
grant execute on function public.record_onboarding_completed(public.account_type) to authenticated;
grant execute on function public.publish_tender(uuid) to authenticated;
grant execute on function public.extend_tender_closing_time(uuid, timestamptz) to authenticated;
grant execute on function public.cancel_tender(uuid, text) to authenticated;
grant execute on function public.award_tender(uuid, uuid) to authenticated;
grant execute on function public.submit_bid(uuid, uuid, numeric, uuid) to authenticated;
grant execute on function public.read_tender_bids(uuid) to authenticated;
grant execute on function public.request_document_download(uuid) to authenticated;
grant execute on function public.admin_list_users(text, integer, integer) to authenticated;
grant execute on function public.admin_list_tenders(public.tender_status, integer, integer) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;
grant execute on function public.admin_cancel_tender(uuid, text) to authenticated;

-- Helpers that row-level security policies call; they run as the querying role.
grant execute on function private.caller_is_active() to authenticated;
grant execute on function private.caller_is_admin() to authenticated;
grant execute on function private.uploads_in_last_day(text) to authenticated;
grant execute on function private.is_own_draft_tender_folder(text) to authenticated;
grant execute on function private.bid_refusal_reason(uuid, uuid) to authenticated;
grant execute on function private.try_uuid(text) to authenticated;
grant execute on function private.is_own_unsubmitted_bid_folder(text) to authenticated;

-- The service role (Edge Functions only, PRD 8.7) keeps full access to the tables it maintains.
grant all on public.subscriptions, public.email_log to service_role;
grant select on all tables in schema public to service_role;

-- PRD 8.2 "anywhere": the same revoke on Storage's tables. Storage owns them, so Postgres may only
-- warn and keep the grants on hosted Supabase. The RLS suite reports which privileges remain, and
-- any that do are documented as a platform exception (OPEN_QUESTIONS.md, item 10).
revoke truncate, references, trigger, maintain on all tables in schema storage from anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;
-- PUBLIC's EXECUTE on new functions is a global default, so it can only be revoked globally.
alter default privileges for role postgres revoke execute on functions from public;
