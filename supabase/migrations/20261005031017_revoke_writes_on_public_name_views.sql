-- Fix for AUDIT.md finding C1. NOT YET APPLIED to the live project.
--
-- supplier_names_public and business_names_public are simple views owned by postgres, so
-- Postgres treats them as writable and runs the writes as postgres, skipping row-level
-- security. Anyone holding INSERT, UPDATE or DELETE on them can change or delete any
-- business or supplier profile. This removes those three privileges from anon and
-- authenticated. SELECT stays, so the browser's company-name lookups keep working.
-- postgres and service_role keep their privileges.
--
-- Still true after this: both views read as postgres, so every company name and user ID
-- remains readable without a login (Supabase advisor "security_definer_view").
--
-- Apply with the SQL Editor, not "supabase db push": push would also try to apply
-- 20261005025300_remote_schema.sql to the live project.
-- Verify with audit/verify-name-view-fix.sql and audit/verify-name-view-fix.mjs.
--
-- Rollback (restores exactly the privileges removed here):
--   grant insert, update, delete on public.supplier_names_public to anon, authenticated;
--   grant insert, update, delete on public.business_names_public to anon, authenticated;

revoke insert, update, delete on public.supplier_names_public from anon, authenticated;
revoke insert, update, delete on public.business_names_public from anon, authenticated;
