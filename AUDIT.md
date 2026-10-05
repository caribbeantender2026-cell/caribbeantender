# CaribbeanTender security audit: database and storage

- **Project:** ProcureMarket (`ijlcjthgwppllhlqocep`), Postgres 17, database timezone UTC
- **Date:** 2026-10-05 UTC (evening of 2026-10-04 in Jamaica)
- **Branch:** `Benji-Branch`
- **Scope:** the live Supabase schema, RLS policies, grants, functions, triggers, views and storage, plus the parts of the browser code that the suspected issues refer to. No application code was changed.

## Summary

- **Most urgent (Critical, C1):** `supplier_names_public` and `business_names_public` are writable views that bypass RLS. Anyone, without logging in, can rename or delete any business or supplier profile through the public API. Deleting a business profile also deletes its tenders and every bid on them.
- **Bids are not sealed:** a business can read bid amounts and proposal documents as soon as they arrive (issue 2).
- **Closing dates are not enforced:** the database accepts bids after the closing date and on closed tenders (issue 3). Separately, the browser hides tenders at 7pm Jamaica time on their closing day (issue 7).
- **Proposals can be swapped (High, H1):** a supplier can replace the proposal file behind a submitted bid at any time, including after the closing date.
- **Subscription fields are protected, with one gap:** suppliers cannot write their subscription fields directly. Column grants and a trigger stop that. But C1 lets an expired supplier delete and recreate their profile to get a fresh 14-day trial (issue 1, partially).
- **Excel uploads fail:** the bid-documents bucket rejects Excel files (issue 6).

| # | Suspected issue | Verdict | Severity |
|---|---|---|---|
| 1 | Supplier sets own subscription fields | **Partially** | High |
| 2 | Business reads bids or documents before closing | **Confirmed** | High |
| 3 | Bid after closing date, or without trial or subscription | **Partially** (closing date: confirmed; access check: not an issue) | High |
| 4 | Supplier reads other suppliers' bids or documents | **Not an issue** | — |
| 5 | User reads or changes another user's profile, tender or bid | **Confirmed** (through the two views, finding C1) | Critical |
| 6 | Excel proposals rejected by the bucket | **Confirmed** | Medium |
| 7 | `closing_date` is a date compared against the UTC date | **Confirmed** | High |
| 8 | Other cross-user access | See [New issues](#3-new-issues): 1 Critical, 1 High, 8 Medium | — |

## How this was checked

Everything here comes from the live project, read without changing data:

- **Catalog query:** [audit/inventory.sql](audit/inventory.sql) is a single read-only SELECT over the system catalogs. It ran through `supabase db query --linked`, which sends the SQL via the Supabase Management API, so no Docker and no database password were needed. Its raw output is in `audit/inventory-results.json`. That file is gitignored because function bodies can contain secrets; this one doesn't.
- **Follow-up queries:** read-only SELECTs for view updatability, schema grants and the database timezone.
- **Advisors:** Supabase's security advisors, fetched with `supabase db advisors --linked`.
- **Edge Function:** the source of `payment-webhook`, downloaded with `supabase functions download --use-api`.
- **Data read:** no application rows were read or changed. The only rows read were storage bucket settings and role metadata.
- **Production change:** one temporary login role was created by the CLI. See [Changes to production during the audit](#changes-to-production-during-the-audit).

**The migration file is rebuilt, not dumped.** `supabase db pull` was not run. It needs Docker, and it also writes to the remote migration history table. Instead, [supabase/migrations/20261005025300_remote_schema.sql](supabase/migrations/20261005025300_remote_schema.sql) was generated from the catalog output and checked as a round trip: applied to an empty Postgres 17, its inventory matched the live one exactly for tables, columns, constraints, indexes, effective privileges, column grants, policies, function definitions, triggers, views, enums and bucket settings. The remote migration history does not list this file, so **never run `supabase db push` against the live project with it.**

## Changes to production during the audit

| When (UTC, 2026-10-05) | Change | Status |
|---|---|---|
| Between 02:51:35 and 02:51:39 | The Supabase CLI created the login role `cli_login_postgres` (can log in; member of `postgres`) through the Management API while starting the first `supabase db query --linked` call. | Its password expired at **02:56:38 UTC** (`rolvaliduntil`). The role is kept, on the owner's instruction (2026-10-05). |

- **The creation time is a window.** Postgres doesn't record when a role was created. The window runs from when the command's two output files were created to when they were last written. The expiry time is the role's `rolvaliduntil`; a read at 02:56:24 UTC showed the role still valid.
- **Cause:** for any `--linked` command run without a database password, the CLI's root pre-run creates this role through the Management API ([root.go:118](https://github.com/supabase/cli/blob/v2.102.0/apps/cli-go/cmd/root.go#L118), [db_url.go:157-170](https://github.com/supabase/cli/blob/v2.102.0/apps/cli-go/internal/utils/flags/db_url.go#L157-L170)). The command itself doesn't use the role.
- **Prevented after that:** every later CLI call set a dummy `SUPABASE_DB_PASSWORD`, which skips the role step. None of those calls printed "Initialising login role".
- **No application data was read or changed.** Every query was a SELECT over system catalogs (`pg_catalog`, `information_schema`, `pg_policies`, `pg_roles`), plus the two rows of `storage.buckets` (bucket settings only). No rows were read from `profiles`, `business_profiles`, `supplier_profiles`, `tenders`, `bids`, `subscription_plans`, `subscription_events`, `auth.users` or `storage.objects`. No INSERT, UPDATE, DELETE, DDL or GRANT statement was sent.
- **The other calls to Supabase only read:** `supabase link` (configuration reads), `supabase functions download` and `supabase db advisors`.

---

## 1. Inventory

### 1.1 Tables and row-level security

RLS is enabled on every public table and forced on none. The tables are owned by `postgres`, which bypasses RLS.

| Table | RLS | Estimated rows |
|---|---|---|
| `bids` | on | not yet analysed |
| `business_profiles` | on | about 3 |
| `profiles` | on | not yet analysed |
| `subscription_events` | on | not yet analysed |
| `subscription_plans` | on | not yet analysed |
| `supplier_profiles` | on | about 1 |
| `tenders` | on | not yet analysed |

"Not yet analysed" means Postgres has no statistics for the table yet. It is not a row count.

**Columns.** Full definitions, defaults and constraints are in the migration file.

- **`profiles`:** `id` uuid PK → `auth.users` (cascade), `full_name` text not null (2–120 characters), `account_type` enum `account_type` (`business`, `supplier`), `email`, `phone`, `company_name`, `company_address`, `description`, `industry_category`, `created_at`, `updated_at`
- **`business_profiles`:** `user_id` uuid PK → `profiles` (cascade), `company_name` (2–160 characters), `address`, `company_address`, `phone`, `contact_email`, `description`, `created_at`, `updated_at`
- **`supplier_profiles`:** `user_id` uuid PK → `profiles` (cascade), `company_name` (2–160 characters), `address`, `company_address`, `industry_category`, `phone`, `contact_email`, `description`, `trial_started_at`, `trial_ends_at`, `subscription_status` text, `subscription_plan`, `subscription_started_at`, `subscription_ends_at`, `payment_customer_id`, `payment_subscription_id`, `created_at`, `updated_at`
- **`tenders`:** `id` uuid PK, `business_id` → `business_profiles` (cascade), `title` (3–200 characters), `description`, **`closing_date date not null`** with `CHECK (closing_date >= CURRENT_DATE)`, `status` enum `tender_status` (`open`, `closed`, `cancelled`), `document_path`, `document_name`, `created_at`, `updated_at`
- **`bids`:** `id` uuid PK, `tender_id` → `tenders` (cascade), `supplier_id` → `supplier_profiles` (cascade), `amount numeric(14,2)` > 0, `document_path` not null, `document_name` not null, `created_at`, `updated_at`; `UNIQUE (tender_id, supplier_id)`
- **`subscription_plans`:** `id`, `plan_code` unique, `plan_name`, `description`, `price` ≥ 0, `currency` (default USD), `billing_interval` (`month` or `year`), `interval_count` > 0, `is_active`, `provider_product_id`, `provider_price_id`, timestamps
- **`subscription_events`:** `id`, `supplier_id` → `supplier_profiles` (cascade), `provider`, `provider_event_id` (unique per provider), `event_type`, `subscription_plan`, `amount`, `currency`, `status`, `occurred_at`, `created_at`, `metadata` jsonb

### 1.2 Policies (28), full SQL

No policy exists for these operations, so RLS denies them to API users:

- **`profiles`:** INSERT, DELETE (the signup trigger creates rows)
- **`business_profiles` and `supplier_profiles`:** DELETE
- **`bids`:** UPDATE, DELETE (bids cannot be edited or withdrawn)
- **`subscription_events`:** all writes
- **`subscription_plans`:** all writes
- **`storage.objects`:** UPDATE
- **Role `anon`:** every operation except SELECT on `tenders`, `subscription_plans` and `tender-documents` files

#### public.bids

```sql
create policy business_read_tender_bids on public.bids as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM tenders t
  WHERE ((t.id = bids.tender_id) AND (t.business_id = ( SELECT auth.uid() AS uid))))));

create policy supplier_insert_bid on public.bids as PERMISSIVE for INSERT to authenticated with check (((supplier_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.supplier_has_access(( SELECT auth.uid() AS uid)) AS supplier_has_access)));

create policy supplier_read_own_bids on public.bids as PERMISSIVE for SELECT to authenticated using ((supplier_id = ( SELECT auth.uid() AS uid)));
```

#### public.business_profiles

```sql
create policy business_profile_insert_own on public.business_profiles as PERMISSIVE for INSERT to authenticated with check ((( SELECT auth.uid() AS uid) = user_id));

create policy business_profile_select_own on public.business_profiles as PERMISSIVE for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id));

create policy business_profile_update_own on public.business_profiles as PERMISSIVE for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id));
```

#### public.profiles

```sql
create policy profiles_select_own on public.profiles as PERMISSIVE for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = id));

create policy profiles_update_own on public.profiles as PERMISSIVE for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = id)) with check ((( SELECT auth.uid() AS uid) = id));
```

#### public.subscription_events

```sql
create policy supplier_read_own_subscription_events on public.subscription_events as PERMISSIVE for SELECT to authenticated using ((supplier_id = ( SELECT auth.uid() AS uid)));
```

#### public.subscription_plans

```sql
create policy read_active_subscription_plans on public.subscription_plans as PERMISSIVE for SELECT to anon, authenticated using ((is_active = true));
```

#### public.supplier_profiles

```sql
create policy supplier_profile_insert_own on public.supplier_profiles as PERMISSIVE for INSERT to authenticated with check ((( SELECT auth.uid() AS uid) = user_id));

create policy supplier_profile_select_own on public.supplier_profiles as PERMISSIVE for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id));

create policy supplier_profile_update_own on public.supplier_profiles as PERMISSIVE for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id));
```

#### public.tenders

```sql
create policy business_delete_own_tenders on public.tenders as PERMISSIVE for DELETE to authenticated using ((business_id = ( SELECT auth.uid() AS uid)));

create policy business_insert_tenders on public.tenders as PERMISSIVE for INSERT to authenticated with check (((business_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM business_profiles bp
  WHERE (bp.user_id = ( SELECT auth.uid() AS uid))))));

create policy business_update_own_tenders on public.tenders as PERMISSIVE for UPDATE to authenticated using ((business_id = ( SELECT auth.uid() AS uid))) with check (((business_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM business_profiles bp
  WHERE (bp.user_id = ( SELECT auth.uid() AS uid))))));

create policy tenders_public_read on public.tenders as PERMISSIVE for SELECT to anon, authenticated using (true);
```

#### storage.objects

```sql
create policy "authenticated users read tender files" on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'tender-documents'::text));

create policy "bid parties read bid files" on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'bid-documents'::text) AND (EXISTS ( SELECT 1
   FROM (bids b
     JOIN tenders t ON ((t.id = b.tender_id)))
  WHERE ((b.document_path = objects.name) AND ((b.supplier_id = ( SELECT auth.uid() AS uid)) OR (t.business_id = ( SELECT auth.uid() AS uid))))))));

create policy "business manages own tender files" on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'tender-documents'::text) AND (owner_id = ( SELECT (auth.uid())::text AS uid))));

create policy "business uploads own tender files" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'tender-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.account_type = 'business'::account_type))))));

create policy ct_bid_docs_business_read on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'bid-documents'::text) AND (EXISTS ( SELECT 1
   FROM (bids b
     JOIN tenders t ON ((t.id = b.tender_id)))
  WHERE ((b.document_path = objects.name) AND (t.business_id = ( SELECT auth.uid() AS uid)))))));

create policy ct_bid_docs_insert on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'bid-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM supplier_profiles sp
  WHERE (sp.user_id = ( SELECT auth.uid() AS uid))))));

create policy ct_bid_docs_supplier_read on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'bid-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

create policy ct_tender_docs_insert on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'tender-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM business_profiles bp
  WHERE (bp.user_id = ( SELECT auth.uid() AS uid))))));

create policy ct_tender_docs_read on storage.objects as PERMISSIVE for SELECT to anon, authenticated using ((bucket_id = 'tender-documents'::text));

create policy "supplier manages own bid files" on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'bid-documents'::text) AND (owner_id = ( SELECT (auth.uid())::text AS uid))));

create policy "supplier uploads own bid files" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'bid-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.account_type = 'supplier'::account_type))))));
```

### 1.3 Grants to `anon` and `authenticated`

Effective privileges, as computed by `has_table_privilege` and `has_column_privilege`:

| Object | `anon` | `authenticated` |
|---|---|---|
| `bids`, `business_profiles`, `profiles`, `tenders` | SELECT, INSERT, UPDATE, DELETE, TRUNCATE on all columns | same as `anon` |
| `supplier_profiles` | SELECT, INSERT, UPDATE, DELETE, TRUNCATE on all columns | SELECT, INSERT, DELETE, TRUNCATE on the table; **UPDATE only on** `company_name, address, industry_category, phone, contact_email, description, company_address` |
| `subscription_plans` | SELECT | SELECT |
| `subscription_events` | none | SELECT |
| `supplier_names_public`, `business_names_public` (views) | SELECT, INSERT, UPDATE, DELETE, TRUNCATE | same as `anon` |

- **Column-level grants:** the seven `supplier_profiles` UPDATE grants to `authenticated` listed above are the only explicit column-level grants in the public schema.
- **Schema `private`:** `authenticated` has USAGE; `anon` has nothing.
- **Default privileges in `public`** (for objects created by `postgres` and `supabase_admin`): ALL on new tables, EXECUTE on new functions, and USAGE, SELECT and UPDATE on new sequences, granted to `anon`, `authenticated` and `service_role`.

### 1.4 Functions and triggers

| Function | SECURITY DEFINER | `search_path` | Who can execute | Used by |
|---|---|---|---|---|
| `private.process_subscription_payment(...)` | **yes** | `''` | `postgres` only | Nothing yet. It validates a plan and amount, records a `subscription_events` row and activates or extends a supplier. |
| `private.supplier_has_access(uuid)` | **yes** | `''` | `authenticated` | The `supplier_insert_bid` policy |
| `public.handle_new_caribbeantender_user()` | **yes** | `public` | PUBLIC, `anon`, `authenticated`, `service_role` | Trigger on `auth.users` |
| `public.handle_new_user()` | **yes** | `''` | PUBLIC, `anon`, `authenticated`, `service_role` | **No trigger** (orphaned) |
| `public.set_supplier_trial()` | no | `''` | all | Trigger on `supplier_profiles` |
| `public.set_updated_at()` | no | `''` | all | Five `updated_at` triggers |

| Trigger | Table | Timing | Function |
|---|---|---|---|
| `on_caribbeantender_user_created` | `auth.users` | AFTER INSERT | `handle_new_caribbeantender_user()`: creates the `profiles` row, plus a `business_profiles` or `supplier_profiles` row based on signup metadata. Does **not** set `profiles.account_type`. |
| `set_supplier_trial_on_insert` | `supplier_profiles` | BEFORE INSERT | `set_supplier_trial()`: forces `subscription_status = 'trial'`, a 14-day trial, and null plan, subscription dates and payment IDs |
| `bids_updated`, `business_profiles_updated`, `profiles_updated`, `set_subscription_plans_updated_at`, `set_supplier_profiles_updated_at`, `tenders_updated` | each table | BEFORE UPDATE | `set_updated_at()` |

Full function bodies are in the migration file. The one Edge Function, `payment-webhook` (version 1), is a locked stub: it returns 405 for anything except POST and 503 for POST ([supabase/functions/payment-webhook/index.ts](supabase/functions/payment-webhook/index.ts)). Nothing in the project can mark a supplier as paid today.

### 1.5 Views

| View | Definition | Owner | `security_invoker` | Grants | Writable |
|---|---|---|---|---|---|
| `supplier_names_public` | `SELECT user_id, company_name FROM supplier_profiles` | `postgres` (bypasses RLS) | not set | ALL to `anon` and `authenticated` | **yes**: UPDATE, INSERT and DELETE |
| `business_names_public` | `SELECT user_id, company_name FROM business_profiles` | `postgres` (bypasses RLS) | not set | ALL to `anon` and `authenticated` | **yes**: UPDATE, INSERT and DELETE |

Writability is Postgres's own answer: `information_schema.views` reports `is_updatable = YES` and `is_insertable_into = YES` for both, and `pg_relation_is_updatable(...) = 28`, which is UPDATE + INSERT + DELETE.

### 1.6 Storage buckets

| Bucket | Public | Size limit | Allowed MIME types |
|---|---|---|---|
| `bid-documents` | no | 10,485,760 bytes (10 MB) | `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `tender-documents` | no | 10 MB | same three types |

RLS is enabled on `storage.objects` and `storage.buckets`. Versioning is disabled on both buckets.

### 1.7 Everything else

- **Schemas:** `public` and `private`.
- **Extensions:** `pg_stat_statements`, `pgcrypto`, `uuid-ossp`, `supabase_vault`. **pg_cron, pg_net and pg_graphql are not installed.**
- **Realtime:** no public tables are in a Realtime publication.
- **Security advisors:**
  - ERROR `security_definer_view` on both views
  - WARN: `handle_new_caribbeantender_user` and `handle_new_user` are SECURITY DEFINER and executable by `anon` and `authenticated`
  - WARN: leaked-password protection is disabled

---

## 2. Suspected issues: verdicts and evidence

### Issue 1: a supplier sets their own `subscription_status`, `trial_ends_at` or `subscription_ends_at` (Partially)

**Direct writes are blocked.**

- **UPDATE:** `authenticated` has no table-level UPDATE on `supplier_profiles` (the ACL is `authenticated=ardDxtm/postgres`, with no `w`), and its column-level UPDATE covers only the seven profile fields in 1.3. An update or upsert touching a subscription column fails on privileges before RLS is even checked.
- **INSERT:** a new row cannot carry paid values, because the `set_supplier_trial_on_insert` trigger overwrites them:

  ```sql
  new.trial_started_at := now();
  new.trial_ends_at := now() + interval '14 days';
  new.subscription_status := 'trial';
  new.subscription_plan := null;
  new.subscription_started_at := null;
  new.subscription_ends_at := null;
  ```

- **DELETE:** no DELETE policy exists on `supplier_profiles`.

**The bypass is through the view (finding C1).** `supplier_names_public` is writable by any user and runs as `postgres`. An expired supplier can `DELETE` their own row through the view, then insert a new `supplier_profiles` row, and `set_supplier_trial` grants a new 14-day trial. That bypasses payment indefinitely. The cost to the supplier is that their past bids are deleted (`bids_supplier_id_fkey ... ON DELETE CASCADE`).

**The browser check is only for display.** [assets/app.js:48-90](assets/app.js#L48-L90) checks access before showing the bid form. The real gate is the `supplier_insert_bid` policy.

### Issue 2: a business reads bids and documents before the closing time (Confirmed)

No bid or bid-document read policy refers to `closing_date`:

```sql
create policy business_read_tender_bids on public.bids as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1 FROM tenders t
    WHERE ((t.id = bids.tender_id) AND (t.business_id = ( SELECT auth.uid() AS uid))))));

create policy "bid parties read bid files" on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'bid-documents'::text) AND (EXISTS ( SELECT 1 FROM (bids b JOIN tenders t ON ((t.id = b.tender_id)))
    WHERE ((b.document_path = objects.name) AND ((b.supplier_id = ( SELECT auth.uid() AS uid)) OR (t.business_id = ( SELECT auth.uid() AS uid))))))));

create policy ct_bid_docs_business_read on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'bid-documents'::text) AND (EXISTS ( SELECT 1 FROM (bids b JOIN tenders t ON ((t.id = b.tender_id)))
    WHERE ((b.document_path = objects.name) AND (t.business_id = ( SELECT auth.uid() AS uid)))))));
```

The browser doesn't check either: `view-bids.html` loads `select('*')` on `bids` and signs a document URL for each bid ([assets/app.js:233-271](assets/app.js#L233-L271)).

### Issue 3: a bid after the closing date, or from a supplier without access (Partially)

**The closing date is not enforced (confirmed).** The only INSERT policy on `bids` checks who the supplier is and whether they have access, never the tender:

```sql
create policy supplier_insert_bid on public.bids as PERMISSIVE for INSERT to authenticated
  with check (((supplier_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.supplier_has_access(( SELECT auth.uid() AS uid)) AS supplier_has_access)));
```

No trigger on `bids` fires on INSERT; `bids_updated` is BEFORE UPDATE only. So bids are accepted after `closing_date` and on tenders whose status is `closed` or `cancelled`. Hiding the Submit Bid button ([assets/app.js:208](assets/app.js#L208)) is the only barrier.

**Bids without an active trial or subscription are blocked (not an issue).** `private.supplier_has_access` returns true only for `subscription_status = 'trial' and trial_ends_at > now()`, or for `subscription_status = 'active' and (subscription_ends_at is null or subscription_ends_at > now())`. Issue 1 covers the trial-reset route around it.

### Issue 4: a supplier reads other suppliers' bids or documents (Not an issue)

- **Bids:** the only bid SELECT policies are `supplier_read_own_bids` (`supplier_id = auth.uid()`) and `business_read_tender_bids` (the tender owner).
- **Bid files:** a supplier can read only their own folder (`ct_bid_docs_supplier_read`: `(storage.foldername(name))[1] = auth.uid()`) or files referenced by their own bid (`"bid parties read bid files"`).
- **No listing:** no policy lets a supplier see another supplier's objects.
- **Caveat:** a bid's `document_path` is not tied to the bidder's own folder. See M5.

### Issue 5: a user reads or changes another user's profile, tender or bid (Confirmed, through the views)

**The table policies themselves are correct:**

- **Reads:** `profiles`, `business_profiles` and `supplier_profiles` allow SELECT and UPDATE only where `auth.uid() = id` or `auth.uid() = user_id`.
- **Tender changes:** UPDATE and DELETE on `tenders` require `business_id = auth.uid()`.
- **Bid changes:** `bids` has no UPDATE or DELETE policy.

**The views bypass all of that.** `supplier_names_public` and `business_names_public` are writable, granted to `anon` and `authenticated`, and run as `postgres`, which bypasses RLS. So **without logging in**, anyone can:

- **Change company names:** `UPDATE ... SET company_name` on any business or supplier, which is a way to impersonate a company in bid lists.
- **Delete any profile:** `DELETE` any business or supplier profile. Through `tenders_business_id_fkey`, `bids_tender_id_fkey`, `bids_supplier_id_fkey` and `subscription_events_supplier_id_fkey` (all `ON DELETE CASCADE`), that also deletes the tenders, the bids on them, and subscription history. Storage files are left behind as orphans.
- **Add profiles for others:** `INSERT` a business or supplier profile row for any existing user ID.
- **List everyone:** read every business's and supplier's user ID and company name.

### Issue 6: Excel proposals fail (Confirmed)

The bucket allows only PDF and Word (section 1.6). The browser allows Excel ([assets/app.js:125](assets/app.js#L125): `['pdf','doc','docx','xls','xlsx']`) and uploads with the file's own type ([assets/app.js:23](assets/app.js#L23): `{contentType:file.type}`). Storage therefore rejects `.xls` and `.xlsx` files after the form has accepted them.

### Issue 7: `closing_date` is a date compared against the UTC date (Confirmed)

`tenders.closing_date` is `date not null`, so it cannot hold a closing time at all. The browser compares it against the UTC date:

```js
const today=new Date().toISOString().slice(0,10);          // assets/app.js:195, also 208 and 357
...gte('closing_date',today)
```

Jamaica is UTC−5 all year. From 7:00pm local time, `toISOString()` already returns tomorrow's date, so a tender closing "today" drops off [tenders.html](tenders.html) and loses its Submit Bid button about five hours early ([assets/app.js:195](assets/app.js#L195), [208](assets/app.js#L208), [357](assets/app.js#L357)). The database also runs in UTC, so the `CHECK (closing_date >= CURRENT_DATE)` constraint and `now()` use UTC. Because of issue 3, the tender disappears only in the browser: the database keeps accepting bids indefinitely.

---

## 3. New issues

### Critical

**C1. The two public name views let anyone without a login edit and delete every business and supplier profile.**
Evidence is in sections 1.5 and 2 (issue 5); Supabase's advisor also rates both views ERROR. Example request, needing only the publishable key:
`DELETE /rest/v1/business_names_public?user_id=not.is.null` would delete every business profile, every tender and every bid.
*Fix direction:* drop both views. Replace them with a `security_invoker` view over a column-limited policy, or with a SECURITY DEFINER function that returns names only. Revoke INSERT, UPDATE and DELETE on anything that only needs reading.
*Prepared fix, not applied:* [supabase/migrations/20261005031017_revoke_writes_on_public_name_views.sql](supabase/migrations/20261005031017_revoke_writes_on_public_name_views.sql) revokes INSERT, UPDATE and DELETE on both views from `anon` and `authenticated` and keeps SELECT. It closes the write hole; the views can still read every row. Verify it with [audit/verify-name-view-fix.sql](audit/verify-name-view-fix.sql) and [audit/verify-name-view-fix.mjs](audit/verify-name-view-fix.mjs). On a scratch copy of the schema, the checks showed writes allowed before the fix, refused for both roles after it, and allowed again after the rollback SQL, which restored the original permission entries exactly.
*Still flagged after the fix:* the Security Advisor will keep reporting both views as `security_definer_view` (ERROR). They still bypass RLS because they aren't `security_invoker` views; the revoke removes only the writes. The permanent fix is Phase 1 item P1 (section 6).
*Rollout (approved in principle; waiting for the lead developer's go-ahead):*

1. Read-only: record the exact row count of every public table with [audit/row-counts.sql](audit/row-counts.sql) into `audit/row-counts-before.txt`.
2. The owner applies the migration in the SQL Editor.
3. Run check 1 (read-only).
4. Only if check 1 shows select = true and insert, update and delete = false in all four rows, run check 3 through the REST API.
5. Check 2 is not run on production.
6. Read-only: record row counts again into `audit/row-counts-after.txt` and diff them against the before file.

### High

**H1. A supplier can replace the proposal behind a submitted bid at any time, including after closing.**
These two policies allow deleting your own bid file and uploading a new file to the same path, with no time limit:

```sql
create policy "supplier manages own bid files" on storage.objects as PERMISSIVE for DELETE to authenticated
  using (((bucket_id = 'bid-documents'::text) AND (owner_id = ( SELECT (auth.uid())::text AS uid))));
create policy ct_bid_docs_insert on storage.objects as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'bid-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1 FROM supplier_profiles sp WHERE (sp.user_id = ( SELECT auth.uid() AS uid))))));
```

The bid row stores only the path, and bucket versioning is off, so the business sees whatever file is there when it opens the bid. Sealed bidding needs the proposal to be fixed at submission.

### Medium

- **M1. `CHECK (closing_date >= CURRENT_DATE)` re-runs on every update.** Once a tender's closing date has passed, *any* UPDATE to that row fails, so its status can never be set to `closed` or `cancelled`. A `pg_dump` restore that includes past tenders would fail on that row data. After 7pm Jamaica time, a business also can't create a tender that closes "today". The first two consequences follow from how CHECK constraints work and are not tested yet.
- **M2. A business can change or delete a tender after bids arrive.** `business_update_own_tenders` allows changing `closing_date`, `description` and `document_path` at any time. `business_delete_own_tenders` deletes the tender and, through the cascade, every bid on it, with no record kept. `"business manages own tender files"` allows replacing the tender document.
- **M3. Tender documents can be read without logging in.** `ct_tender_docs_read` grants SELECT on `tender-documents` to `anon`, and `tenders_public_read` (`using (true)`, also granted to `anon`) exposes every `document_path`. [SETUP.md](assets/SETUP.md) says tender files are "readable by signed-in users". Whether this should be public is a product decision.
- **M4. Uploads have no quota or access check.** `ct_bid_docs_insert` requires only that a `supplier_profiles` row exists, not an active trial; any signed-in user can create one for themselves. `ct_tender_docs_insert` is the same for businesses. Anyone who registers can upload an unlimited number of 10 MB files.
- **M5. `bids.document_path` is not tied to the bidder.** The INSERT policy doesn't check that the path is in the bidder's own folder or that the object exists. A bid can point at a file uploaded later (which makes H1 easier). It can also point at another supplier's path, which `"bid parties read bid files"` would then let the bidder read. Paths contain a random UUID, so this needs the path to have leaked.
- **M6. RLS is the only barrier.** `anon` and `authenticated` hold INSERT, UPDATE, DELETE and TRUNCATE on every core table, and the default privileges grant ALL on any new public table (section 1.3). A table created later without RLS would be immediately readable and writable by anyone. TRUNCATE can't be reached through the REST API (pg_graphql is not installed), so this is hardening, not an open hole.
- **M7. Two SECURITY DEFINER trigger functions are executable by `anon` and `authenticated`** (advisor WARN). Postgres doesn't allow trigger functions to be called directly, so the practical risk is low; I did not test the `/rpc` call. `handle_new_user()` isn't attached to anything and can be dropped.
- **M8. Leaked-password protection is disabled in Auth** (advisor WARN).

### Cleanup (not security)

- **Signup fails when the name is shorter than 2 characters.** `handle_new_caribbeantender_user` inserts `coalesce(new.raw_user_meta_data ->> 'full_name', '')`, but `profiles_full_name_check` requires 2–120 characters. The `auth.users` insert therefore fails for a one-letter name, a name of only spaces ([register.html](register.html) has `required` but no `minlength`, and trims the value), or a user created without metadata (for example, from the dashboard). This was reproduced on the scratch copy of the schema. Phase 1 item P2.
- **`profiles.account_type` is never set.** The active signup trigger, `handle_new_caribbeantender_user`, doesn't fill it. As a result, the storage policies `"business uploads own tender files"` and `"supplier uploads own bid files"` (which check `p.account_type`) never match, and their `ct_*` twins do the real work. These are duplicate, overlapping policies.
- **Running [profiles-auth-check.sql](profiles-auth-check.sql) would break signup.** It attaches `handle_new_user()` as a second `auth.users` trigger. That function inserts into `profiles` with no `on conflict`, so every signup would fail on a duplicate key. Do not run it.
- **Duplicate unique indexes:** `bids_one_per_supplier_per_tender` duplicates `bids_tender_id_supplier_id_key`, and the `*_one_per_user` indexes duplicate the primary keys.
- **Two address columns:** `address` and `company_address` both exist on `business_profiles` and `supplier_profiles`.

---

## 4. Test plan for issues 1–5 (not run)

### Where to run it

**Staging only, never the live project** (approved 2026-10-05 on that condition). **Paused until the contract is signed.** The owner will then create the staging project in their own Supabase account and link it. The live project has real data (about 3 business profiles and 1 supplier profile), and tests 1d and 5f delete data if C1 is real. The script refuses to run against `ijlcjthgwppllhlqocep`.

**Why staging must be a hosted Supabase project, not plain Postgres.** The tests depend on four things Supabase provides outside the schema. Plain Postgres has none of them. The scratch copy used for this audit (PGlite) fakes `auth.uid()` as always null, so it only proves the schema and grants, not behaviour.

| What the tests need | How a hosted staging project provides it | Plain Postgres |
|---|---|---|
| `anon` and `authenticated` roles | Supabase Auth issues a JWT on sign-in; the REST API (PostgREST) switches the database session to the JWT's `role` claim on every request. A request without a login runs as `anon`. | Roles can be created, but nothing switches between them per request |
| `auth.uid()` | Supabase's own `auth.uid()` reads `sub` from the request's JWT claims, which PostgREST sets per request | Must be faked. `set local role authenticated` plus `set local request.jwt.claims` reproduces table policies, but not the REST layer |
| Storage schema and policies | Supabase creates `storage.buckets`, `storage.objects`, `storage.foldername()` and `owner_id`. The Storage API enforces bucket size and MIME limits, sets `owner_id`, signs URLs, and runs object queries as the caller, so the `storage.objects` policies apply exactly as in production. | None of the Storage API exists: no uploads, signed URLs, MIME or size checks (tests 2b, 4b, 4c, H1 and issue 6) |
| The REST paths the attacks use (`PATCH`, `DELETE` and `POST` on the views, the upsert in 1b) | The same PostgREST as production | Absent |

The migration only adds this project's own objects (the `public` and `private` schemas, policies on `storage.objects`, bucket settings). Supabase supplies everything above. Running the Supabase stack locally (`supabase start`) would also be faithful, but it needs Docker.

**Differences between staging and production to control:**

- **Versions:** production runs Postgres 17.6.1.155, Auth (GoTrue) v2.197.0, PostgREST v14.5 and Storage v1.77.5 (from `supabase link`). A new project may get newer versions. Record staging's versions next to the results.
- **Email confirmation:** turned off in staging so the scripted sign-ups can log in. This doesn't affect RLS.
- **Test 3c needs a tender whose closing date has passed.** The closing-date CHECK constraint stays in place, exactly as in production. Instead, setup creates a tender that closes today (UTC), and the main script runs after the next midnight UTC.
- **Sign-ups must carry a `full_name` of at least 2 characters** (see Cleanup). The setup script does this. Creating users from the dashboard fails.

**Steps:**

1. The owner creates the staging project in their own Supabase account and links it. In its SQL Editor, run [supabase/migrations/20261005025300_remote_schema.sql](supabase/migrations/20261005025300_remote_schema.sql). Do **not** apply the name-view fix yet. Check that `show timezone;` returns `UTC`, as it does in production.
2. In Authentication → Providers → Email, turn **Confirm email** off.
3. Create the five test accounts (setup script below).
4. In the staging SQL Editor, expire one supplier's trial, and create the tender for test 3c that closes today (UTC). **Staging only.**

   ```sql
   update public.supplier_profiles
   set trial_ends_at = now() - interval '1 day'
   where user_id = (select id from auth.users where email = 'ct-test-supplier-expired@example.com');

   insert into public.tenders (business_id, title, description, closing_date)
   select id, 'Audit past tender', 'Closes today (UTC); used by test 3c after midnight UTC', current_date
   from auth.users where email = 'ct-test-business-alpha@example.com'
   returning id;   -- use this as PAST_TENDER_ID
   ```

5. **After 00:00 UTC the next day:** install the client with `npm install @supabase/supabase-js` in a scratch folder. Set `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY`, `TEST_ACCOUNT_PASSWORD` and `PAST_TENDER_ID`, then run the main script with `node security-tests.mjs`.
6. Apply [the name-view fix](supabase/migrations/20261005031017_revoke_writes_on_public_name_views.sql) in staging. Tests 1d and 5f changed data, so reset it in the staging SQL Editor: 1d gave Supplier Expired a fresh trial, and 5f deleted Business Beta's business profile.

   ```sql
   update public.supplier_profiles
   set trial_ends_at = now() - interval '1 day'
   where user_id = (select id from auth.users where email = 'ct-test-supplier-expired@example.com');

   insert into public.business_profiles (user_id, contact_email)
   select id, email from auth.users where email = 'ct-test-business-beta@example.com'
   on conflict (user_id) do nothing;
   ```

   Run the main script again: 1d, 5e and 5f should now say "not reproduced", and every other line should match the first run. Then run [audit/verify-name-view-fix.sql](audit/verify-name-view-fix.sql) and [audit/verify-name-view-fix.mjs](audit/verify-name-view-fix.mjs) against staging.

### Test accounts

| Name | Type | State |
|---|---|---|
| Business Alpha | business | owns the test tenders |
| Business Beta | business | the second business; its profile is the target of test 5f |
| Supplier One | supplier | active trial; submits the bid used in tests 2 and 4 |
| Supplier Two | supplier | active trial; the "other supplier" in tests 4 and 5 |
| Supplier Expired | supplier | trial ended (setup step 4) |
| Anonymous | none | publishable key only |

### Setup script

```js
// create-test-accounts.mjs: staging only.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.STAGING_SUPABASE_URL;
const publishableKey = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY;
const testPassword = process.env.TEST_ACCOUNT_PASSWORD;
if (supabaseUrl.includes('ijlcjthgwppllhlqocep')) throw new Error('Refusing to run against the production project.');

const testAccounts = [
  { email: 'ct-test-business-alpha@example.com', fullName: 'Business Alpha', accountType: 'business' },
  { email: 'ct-test-business-beta@example.com', fullName: 'Business Beta', accountType: 'business' },
  { email: 'ct-test-supplier-one@example.com', fullName: 'Supplier One', accountType: 'supplier' },
  { email: 'ct-test-supplier-two@example.com', fullName: 'Supplier Two', accountType: 'supplier' },
  { email: 'ct-test-supplier-expired@example.com', fullName: 'Supplier Expired', accountType: 'supplier' },
];

for (const account of testAccounts) {
  const client = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signUp({
    email: account.email,
    password: testPassword,
    options: { data: { full_name: account.fullName, account_type: account.accountType } },
  });
  console.log(account.email, error ? `failed: ${error.message}` : 'created');
}
```

### Expected results

"If the issue is real" is what the test shows when the problem exists. "Predicted" is what the live policies and grants say should happen. The run confirms one or the other.

| Test | What it does | If the issue is real | Predicted |
|---|---|---|---|
| 1a | Supplier One updates its own `subscription_status` to `active` | Update succeeds and returns `active` | Fails: `42501` permission denied |
| 1b | Same, through the profile form's upsert | Row becomes `active` | Fails: `42501` |
| 1c | Business Beta inserts a supplier row with `subscription_status: 'active'` | Row is `active` | Insert succeeds but the row is `trial`, ending 14 days from now |
| 1d | Supplier Expired deletes its row through `supplier_names_public`, then re-inserts | Delete count 1; new trial ends 14 days from now | **Reproduces** (C1) |
| 2a | Business Alpha reads bids on its open tender | Supplier One's bid and amount are returned | **Reproduces** |
| 2b | Business Alpha signs a URL for Supplier One's document | Signed URL issued | **Reproduces** |
| 3a | Supplier Expired bids | Bid accepted | Fails: `42501` row-level security violation |
| 3b | Supplier Two bids on a tender with status `closed` | Bid accepted | **Reproduces** |
| 3c | Supplier Two bids on `PAST_TENDER_ID` | Bid accepted | **Reproduces** |
| 4a | Supplier Two reads bids on the open tender | Supplier One's bid is returned | 0 rows |
| 4b | Supplier Two signs a URL for Supplier One's document | Signed URL issued | Fails: object not found |
| 4c | Supplier Two lists Supplier One's folder | Objects listed | 0 objects |
| 5a | Business Beta updates Business Alpha's tender | 1 row changed | 0 rows |
| 5b | Business Beta deletes Business Alpha's tender | 1 row deleted | 0 rows |
| 5c | Supplier Two reads and edits Supplier One's profile | Row read or changed | 0 and 0 |
| 5d | Supplier Two reads Business Alpha's `profiles` row | Row returned | 0 rows |
| 5e | Anonymous renames Supplier Two through `supplier_names_public` | Name changed | **Reproduces** (C1) |
| 5f | Anonymous deletes Business Beta through `business_names_public` | Profile and its tender gone | **Reproduces** (C1) |
| H1 | Supplier One deletes and re-uploads its proposal at the same path | Business Alpha downloads the new content | **Reproduces** |

The order matters: 3a must run before 1d, and the destructive tests 1d and 5f run last.

### Main script

```js
// security-tests.mjs: run against a STAGING project only. Prints one line per test.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.STAGING_SUPABASE_URL;
const publishableKey = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY;
const testPassword = process.env.TEST_ACCOUNT_PASSWORD;
if (!supabaseUrl || !publishableKey || !testPassword) {
  throw new Error('Set STAGING_SUPABASE_URL, STAGING_SUPABASE_PUBLISHABLE_KEY and TEST_ACCOUNT_PASSWORD.');
}
if (supabaseUrl.includes('ijlcjthgwppllhlqocep')) throw new Error('Refusing to run against the production project.');

const accountEmails = {
  businessAlpha: 'ct-test-business-alpha@example.com',
  businessBeta: 'ct-test-business-beta@example.com',
  supplierOne: 'ct-test-supplier-one@example.com',
  supplierTwo: 'ct-test-supplier-two@example.com',
  supplierExpired: 'ct-test-supplier-expired@example.com',
};

function createApiClient() {
  return createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(email) {
  const client = createApiClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password: testPassword });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { client, userId: data.user.id };
}

function record(testName, issueReproduced, detail) {
  console.log(`${issueReproduced ? 'ISSUE REPRODUCED' : 'not reproduced  '} | ${testName} | ${detail}`);
}

function describeError(error) {
  return `${error.code ?? ''} ${error.message}`.trim();
}

function dateInDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function createTender(business, title) {
  const { data, error } = await business.client
    .from('tenders')
    .insert({ business_id: business.userId, title, description: 'Audit test tender', closing_date: dateInDays(7), status: 'open' })
    .select('id')
    .single();
  if (error) throw new Error(`Could not create tender: ${error.message}`);
  return data.id;
}

async function uploadProposal(supplier, content) {
  const documentPath = `${supplier.userId}/${crypto.randomUUID()}-proposal.pdf`;
  const { error } = await supplier.client.storage
    .from('bid-documents')
    .upload(documentPath, new Blob([content], { type: 'application/pdf' }), { contentType: 'application/pdf' });
  if (error) throw new Error(`Could not upload proposal: ${error.message}`);
  return documentPath;
}

async function submitBid(supplier, tenderId, amount, content) {
  const documentPath = await uploadProposal(supplier, content);
  const { error } = await supplier.client
    .from('bids')
    .insert({ tender_id: tenderId, supplier_id: supplier.userId, amount, document_path: documentPath, document_name: 'proposal.pdf' });
  return { documentPath, error };
}

const businessAlpha = await signIn(accountEmails.businessAlpha);
const businessBeta = await signIn(accountEmails.businessBeta);
const supplierOne = await signIn(accountEmails.supplierOne);
const supplierTwo = await signIn(accountEmails.supplierTwo);
const supplierExpired = await signIn(accountEmails.supplierExpired);
const anonymous = createApiClient();

// Fixtures.
const openTenderId = await createTender(businessAlpha, 'Audit open tender');
const closedStatusTenderId = await createTender(businessAlpha, 'Audit closed-status tender');
const betaTenderId = await createTender(businessBeta, 'Audit Beta tender');
const supplierOneBid = await submitBid(supplierOne, openTenderId, 1000, 'original proposal');
if (supplierOneBid.error) throw new Error(`Supplier One could not bid: ${supplierOneBid.error.message}`);

// Issue 2: the tender owner sees bids and documents before closing.
{
  const { data, error } = await businessAlpha.client.from('bids').select('supplier_id, amount').eq('tender_id', openTenderId);
  record('2a business reads bids before closing', !error && data.length > 0,
    error ? describeError(error) : `${data.length} bid(s), amounts: ${data.map(bid => bid.amount).join(', ')}`);
}
{
  const { data, error } = await businessAlpha.client.storage.from('bid-documents').createSignedUrl(supplierOneBid.documentPath, 60);
  record('2b business downloads bid document before closing', !error && Boolean(data?.signedUrl),
    error ? error.message : 'signed URL issued');
}

// Issue 4: another supplier tries to see Supplier One's bid and document.
{
  const { data, error } = await supplierTwo.client.from('bids').select('supplier_id').eq('tender_id', openTenderId);
  record('4a supplier reads another supplier\'s bids', !error && data.some(bid => bid.supplier_id !== supplierTwo.userId),
    error ? describeError(error) : `${data.length} row(s)`);
}
{
  const { data, error } = await supplierTwo.client.storage.from('bid-documents').createSignedUrl(supplierOneBid.documentPath, 60);
  record('4b supplier downloads another supplier\'s document', !error && Boolean(data?.signedUrl),
    error ? error.message : 'signed URL issued');
}
{
  const { data, error } = await supplierTwo.client.storage.from('bid-documents').list(supplierOne.userId);
  record('4c supplier lists another supplier\'s folder', !error && data.length > 0,
    error ? error.message : `${data.length} object(s)`);
}

// Issue 3: bids that should be refused. 3a must run before 1d, which resets this supplier's trial.
{
  const { error } = await submitBid(supplierExpired, openTenderId, 500, 'expired supplier proposal').catch(uploadError => ({ error: uploadError }));
  record('3a supplier without trial or subscription bids', !error, error ? describeError(error) : 'bid accepted');
}
{
  const { error: closeError } = await businessAlpha.client.from('tenders').update({ status: 'closed' }).eq('id', closedStatusTenderId);
  if (closeError) throw new Error(`Could not close tender: ${closeError.message}`);
  const { error } = await submitBid(supplierTwo, closedStatusTenderId, 750, 'proposal for closed tender');
  record('3b bid accepted on a closed tender', !error, error ? describeError(error) : 'bid accepted');
}
if (process.env.PAST_TENDER_ID) {
  const { error } = await submitBid(supplierTwo, process.env.PAST_TENDER_ID, 800, 'after-deadline proposal');
  record('3c bid accepted after the closing date', !error, error ? describeError(error) : 'bid accepted');
} else {
  console.log('skipped          | 3c bid after the closing date | set PAST_TENDER_ID (setup step 4)');
}

// Issue 1: supplier tries to give itself a paid subscription.
{
  const { data, error } = await supplierOne.client
    .from('supplier_profiles')
    .update({ subscription_status: 'active', subscription_ends_at: '2099-01-01T00:00:00Z' })
    .eq('user_id', supplierOne.userId)
    .select('subscription_status, subscription_ends_at');
  record('1a supplier updates own subscription fields', !error && data?.[0]?.subscription_status === 'active',
    error ? describeError(error) : JSON.stringify(data));
}
{
  const { error } = await supplierOne.client
    .from('supplier_profiles')
    .upsert({ user_id: supplierOne.userId, company_name: 'Supplier One Ltd', subscription_status: 'active', subscription_ends_at: '2099-01-01T00:00:00Z' }, { onConflict: 'user_id' });
  const { data } = await supplierOne.client.from('supplier_profiles').select('subscription_status').eq('user_id', supplierOne.userId).single();
  record('1b supplier upserts own subscription fields', data?.subscription_status === 'active',
    error ? describeError(error) : JSON.stringify(data));
}
{
  const { error } = await businessBeta.client
    .from('supplier_profiles')
    .insert({ user_id: businessBeta.userId, contact_email: accountEmails.businessBeta, subscription_status: 'active', subscription_ends_at: '2099-01-01T00:00:00Z' });
  const { data } = await businessBeta.client
    .from('supplier_profiles')
    .select('subscription_status, trial_ends_at, subscription_ends_at')
    .eq('user_id', businessBeta.userId)
    .single();
  record('1c new supplier row keeps browser-supplied paid status', data?.subscription_status === 'active',
    error ? describeError(error) : JSON.stringify(data));
}

// Issue 5: users acting on rows that are not theirs.
{
  const { data, error } = await businessBeta.client.from('tenders').update({ title: 'Changed by Business Beta' }).eq('id', openTenderId).select('id');
  record('5a business updates another business\'s tender', !error && data.length > 0, error ? describeError(error) : `${data.length} row(s) changed`);
}
{
  const { count, error } = await businessBeta.client.from('tenders').delete({ count: 'exact' }).eq('id', openTenderId);
  record('5b business deletes another business\'s tender', !error && count > 0, error ? describeError(error) : `${count} row(s) deleted`);
}
{
  const { data: readRows } = await supplierTwo.client.from('supplier_profiles').select('user_id').eq('user_id', supplierOne.userId);
  const { data: changedRows } = await supplierTwo.client
    .from('supplier_profiles')
    .update({ company_name: 'Changed by Supplier Two' })
    .eq('user_id', supplierOne.userId)
    .select('user_id');
  const readCount = readRows?.length ?? 0;
  const changedCount = changedRows?.length ?? 0;
  record('5c supplier reads or edits another supplier\'s profile', readCount > 0 || changedCount > 0, `read ${readCount}, changed ${changedCount}`);
}
{
  const { data } = await supplierTwo.client.from('profiles').select('id, email').eq('id', businessAlpha.userId);
  record('5d user reads another user\'s profile', (data?.length ?? 0) > 0, `${data?.length ?? 0} row(s)`);
}
{
  const { data, error } = await anonymous
    .from('supplier_names_public')
    .update({ company_name: 'Renamed without login' })
    .eq('user_id', supplierTwo.userId)
    .select('user_id, company_name');
  record('5e anonymous renames a supplier through supplier_names_public', !error && data.length > 0,
    error ? describeError(error) : JSON.stringify(data));
}

// H1: the proposal behind a submitted bid is replaced.
{
  const { error: removeError } = await supplierOne.client.storage.from('bid-documents').remove([supplierOneBid.documentPath]);
  const { error: uploadError } = await supplierOne.client.storage
    .from('bid-documents')
    .upload(supplierOneBid.documentPath, new Blob(['replaced proposal'], { type: 'application/pdf' }), { contentType: 'application/pdf' });
  const { data } = await businessAlpha.client.storage.from('bid-documents').download(supplierOneBid.documentPath);
  const contentSeenByBusiness = data ? await data.text() : null;
  record('H1 submitted proposal file replaced', contentSeenByBusiness === 'replaced proposal',
    `remove: ${removeError?.message ?? 'ok'}, upload: ${uploadError?.message ?? 'ok'}, business sees: ${contentSeenByBusiness}`);
}

// Destructive tests last.
// 1d: an expired supplier deletes its own profile through the view and recreates it for a fresh trial.
{
  const { count, error } = await supplierExpired.client.from('supplier_names_public').delete({ count: 'exact' }).eq('user_id', supplierExpired.userId);
  const { error: insertError } = await supplierExpired.client
    .from('supplier_profiles')
    .insert({ user_id: supplierExpired.userId, contact_email: accountEmails.supplierExpired });
  const { data } = await supplierExpired.client
    .from('supplier_profiles')
    .select('subscription_status, trial_ends_at')
    .eq('user_id', supplierExpired.userId)
    .maybeSingle();
  const trialRenewed = Boolean(data) && new Date(data.trial_ends_at) > new Date();
  record('1d expired supplier resets trial through supplier_names_public', !error && count > 0 && trialRenewed,
    error ? describeError(error) : `deleted ${count}, insert: ${insertError?.message ?? 'ok'}, now: ${JSON.stringify(data)}`);
}
// 5f: anonymous deletes Business Beta's business profile through the view. If real, its tender goes with it.
{
  const { count, error } = await anonymous.from('business_names_public').delete({ count: 'exact' }).eq('user_id', businessBeta.userId);
  const { data: remainingTenders } = await anonymous.from('tenders').select('id').eq('id', betaTenderId);
  record('5f anonymous deletes a business through business_names_public', !error && count > 0,
    error ? describeError(error) : `deleted ${count}, Business Beta tender rows left: ${remainingTenders?.length ?? 0}`);
}
```

Afterwards, delete the staging project, or delete the five test users in Authentication → Users.

---

## 5. What I could not verify

- **No behaviour has been tested yet.** Every verdict comes from the live catalog plus how Postgres and PostgREST behave. The test plan confirms them.
- **API schema exposure:** I didn't check whether the `private` schema is exposed through the Data API, which decides whether `private.supplier_has_access` can be called as an RPC. I also didn't check whether `/rpc/handle_new_user` actually responds.
- **Auth settings:** apart from leaked-password protection, none were checked (email confirmation, sign-up limits, redirect URLs, session lifetime).
- **Data:** no table data or stored files were read, so I can't say whether any existing data has already been affected by C1.
- **What the migration file leaves out:** comments, sequences, default privileges and Auth configuration.
- **Name-view fix:** tested only on the scratch copy of the schema, not yet on hosted Supabase. Check 2 of [audit/verify-name-view-fix.sql](audit/verify-name-view-fix.sql) will not be run on production (the owner's decision); it remains for staging.

---

## 6. Phase 1 list

- **P1. Replace the two public name views (permanent fix for C1).** Replace `supplier_names_public` and `business_names_public` with `security_invoker` views, or with a narrow function, that expose only company names. At the same time, revoke the grants on them that remain after the prepared fix: TRUNCATE, REFERENCES and TRIGGER. The live access list also shows MAINTAIN (Postgres 17), which can go too. This clears the advisor's `security_definer_view` errors. Note that a `security_invoker` view applies the base tables' RLS to the person querying, and today suppliers can read only their own profile row. So company names will only stay visible in bid lists if a read policy and column grants are added for exactly the name column.
- **P2. Fix signup failing for names shorter than 2 characters.** The signup trigger `handle_new_caribbeantender_user` inserts an empty `full_name` when the name is missing, which `profiles_full_name_check` (2–120 characters) rejects. Repair the trigger's fallback, and make the registration form require at least 2 characters after trimming. Details are under Cleanup in section 3.
