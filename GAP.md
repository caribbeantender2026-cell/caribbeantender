# GAP.md: Stage 0 gap analysis and stage plan

- **Compared:** `PRD.md` v1.0 (13 November 2026) against branch `Benji-Branch` at commit `bad3efa`
- **Date:** 13 November 2026
- **Read in full:** `PRD.md`, `AUDIT.md`, all 13 files in `supabase/migrations/`, and the existing implementation (`src/`, `tests/`, `scripts/`, config)
- **Verified by running:** the existing local checks only (type-check, 13 unit tests, 84 local database tests, the before/after proof). Nothing was run against staging or production.

## 1. Summary

An earlier implementation exists, built from a previous brief. It is a good base for the database and a partial base for the frontend, but it differs from the PRD in a number of specific places. I recommend reworking it, not starting over.

- **Database:** the 11 rework migrations (`20261005040100` to `20261005041100`) cover C1, A1, A2, A3, A4, A6, A7 and most of A8 in principle. About half of the data model the PRD asks for is missing (categories, documents tables, forms, email log, preferences, staff), and several rules differ from the PRD (listed in section 4). **None of these migrations has been applied anywhere**, so they can be rewritten in place rather than patched with more migrations.
- **Frontend:** a React/Vite/Tailwind app ports the old site's pages. It has no categories, multiple documents, forms, onboarding, admin, site pages, sign-in-only browsing or Terms checkbox.
- **Edge Functions, emails, Playwright, CI, README, DEPLOY:** none exist yet. The only Edge Function is the production `payment-webhook` stub, which is Phase 3.
- **Tests:** 84 database tests pass on a local Postgres emulation (PGlite), and every fix has a before/after proof. A staging suite is written but has never run. Neither yet meets the PRD's bar, which requires the local Supabase stack or staging.
- **Blocking Stage 1:** the staging project ref is still a placeholder (`<YOUR_STAGING_REF>`), and Docker's engine is not running (it's installed), so neither PRD test environment is available yet.
- **Schedule risk:** the Phase 1 beta is due on **23 November 2026, 10 days from now**. Stages 1 to 5 plus the client's open items (forms, legal text, categories, Pro plan, Railway account, DNS) are a lot for that window. See section 9.

## 2. Hard rules: what I found and what I did

| Rule | Finding | Action |
|---|---|---|
| 1. Never connect to production | The Supabase CLI in this repo was **still linked to production** (`supabase/.temp/project-ref` = `ijlcjthgwppllhlqocep`), left over from the October audit. Any `--linked` command would have reached production. | **Removed `supabase/.temp/`** (gitignored CLI cache; this is what `supabase unlink` does, without its telemetry call). The production versions it held are already recorded in `AUDIT.md`. The CLI is now linked to nothing. |
| 1. Never connect to production | `scripts/compare-staging-production.ts` reads production (project details, one `SELECT`, auth config) through the Management API. It has never been run and needs a token that isn't on disk. | Not run. **Stage 1 deletes it** and replaces it with a check of staging against the production values already recorded in `AUDIT.md` (see Q3 in `OPEN_QUESTIONS.md`). |
| 1. Never connect to production | `AUDIT.md`'s C1 rollout plan has me running read-only checks against production (steps a, c, d, f). | Superseded by this rule. Those steps are yours now; `DEPLOY.md` will say so. |
| 1. Production history before this PRD | Recorded for `DEPLOY.md`. All of it happened before this PRD: (a) the 2026-10-05 audit and its CLI login role (in `AUDIT.md`); (b) on 2026-10-07, at your request, one read-only lookup of a single email in production `auth.users` (0 rows), and the production **Auth Site URL changed to `https://caribbeantender-production.up.railway.app/`** in the dashboard; (c) a Railway project `caribbeantender` in your account serving the legacy site. | `DEPLOY.md` must reset the Site URL and redirect URLs to caribbeantender.com. I don't know whether you added the Railway redirect URL afterwards. |
| 2. Git stays local | Only one remote, `origin`; no `backup` remote. Nothing pushed since 2026-10-04. Your VS Code setting `git.confirmSync: false` lets one click on Sync push without asking; that is how `Benji-Branch` reached GitHub in October. | No change. I recommend setting `git.confirmSync` to `true`. |
| 2. Branches | The PRD wants `phase-1` and `phase-2`; the work is on `Benji-Branch`. | Created local branch **`phase-1` from `Benji-Branch`** and committed this Stage 0 on it. `Benji-Branch` is untouched. |
| 3. No secrets | `.env*` is gitignored; nothing secret is committed. `legacy/assets/supabase-config.js` holds production's publishable key, which is public by design. **The staging suite uses the staging secret key** in local test scripts to create confirmed users, which conflicts with "service role key only in Edge Functions". | See Q4. |
| 4. Build only what's specified | Items on the branch the PRD doesn't ask for are listed in section 7. | Stage 1 removes them unless you keep them. |
| 7. Code style | No `any`, no banned short names in `src/`, `tests/` or `scripts/`. Two private SQL functions still use `p_` parameter names (kept to avoid recreating a dependent policy). | Stage 1 renames them, since the dependent policy is being replaced anyway. |

Your `PRD.md` and `CLAUDE.md` are gitignored, so they aren't in the repo.

## 3. What exists on the branch

| Area | What's there | Verified |
|---|---|---|
| Baseline | `20261005025300_remote_schema.sql` (production schema, rebuilt from the catalog) and `20261005031017_revoke_writes_on_public_name_views.sql` (the C1 write fix). Both match the PRD's description; keep both untouched. | Round-trip checked in October |
| Rework migrations | 11 files: `company_names` table plus `security_invoker` name views; `subscriptions` table; `closes_at`; tender lifecycle with a `pg_cron` close job; bid rules trigger; sealed bids; `audit_log`; storage policies; signup-name fix; least-privilege grants | 84 local tests pass |
| Local test harness | `tests/database`: PGlite with Supabase's roles, `auth.uid()` and storage tables emulated; `before-after.ts` proves each fix fails before its migration and passes after; `data-migration.test.ts` migrates old-schema rows | Passed today |
| Staging suite | `tests/staging`: supabase-js against the real API, Storage and `pg_cron`; refuses the production ref | **Never run** |
| Frontend | React 19, Vite 8, Tailwind 4, React Router 8, TanStack Query, React Hook Form + Zod, supabase-js; types generated from the migrations. Pages: home, tenders list and details, login, register, forgot and reset password, business and supplier dashboards, profiles, tender form, bids page, submit bid, subscription. Refuses secret keys, and refuses production in development. | Type-check and build pass; 13 unit tests pass; **never run against a real Supabase project** |
| Edge Functions | `payment-webhook`, a locked stub copied from production (returns 405/503) | Read |
| Legacy site | The old static site, unchanged, in `legacy/` | — |

## 4. Database: PRD section 7 against the branch

| Target | On the branch | Gap |
|---|---|---|
| `profiles` + `accepted_terms_at`, `is_active`, `onboarding_completed` | None of the three | Add all three |
| `subscriptions` | Exists, keyed to `profiles.id`; statuses `trialing, active, past_due, canceled, expired`; `current_period_ends_at`; plus plan and payment-provider columns | Key to **`auth.users`**; statuses **`trial, active, expired, cancelled`**; column **`current_period_end`**; copy old values **unchanged** (the branch maps `trial` → `trialing`). Writable by service role **and admin functions** (none yet). See Q7 for the provider columns. |
| `categories` (seeded) | Missing. The profile form offers 6 hard-coded categories stored as free text in `supplier_profiles.industry_category`. | Create and seed; see Q5 for how suppliers get a category for alerts |
| `tenders` + `category_id`, `cancelled_reason` | Missing both. Has `closes_at`, `published_at`, `closed_at`, `awarded_bid_id`, plus `cancelled_at` and `awarded_at`. Still has single `document_path`/`document_name`. | Add both; move documents to `tender_documents` |
| `closing_date` → `closes_at` | Backfills **00:00 Jamaica on the next day** | PRD says **23:59:59 Jamaica on the same date**. Change the backfill and its test. |
| `tender_documents` | Missing | Add |
| `bids` + `currency` (JMD), `submitted_at`, `status` | None of the three. `created_at` is server-set and serves as the submission time. Unique (`tender_id`, `supplier_id`) exists, twice. | Add all three; drop the duplicate index; bid status values: see Q8 |
| `bid_documents` | Missing; one required `document_path` per bid | Add; documents become optional, plus the proposal form |
| `form_definitions`, `form_submissions` | Missing | Add, with the two draft definitions |
| `audit_log` | Exists with `event_type`, `tender_id`, `bid_id`, `details`; logs 3 events; **users can read their own rows**, and **can insert download rows directly** | Restructure to `action`, `entity_type`, `entity_id`, `metadata`; log all P1-14 events; **admins read only**; writes only from triggers and security-definer functions |
| `email_log`, `notification_preferences`, `staff_members` | Missing | Add (Phase 1 uses only the `admin` role) |
| Name views (C1) | `security_invoker` views over a narrow `company_names` table; **business names readable by visitors**; supplier names only by people who can see that supplier's bids | **Signed-in only**, as the PRD says. Keep the narrow table, since it's what stops phone numbers and addresses leaking. |
| Data migration | Trials copied (with renamed statuses), old columns dropped; tenders get statuses from their dates; bids kept | Copy unchanged; existing `document_path` values become `tender_documents` and `bid_documents` rows; existing files keep their old paths, so storage policies must also cover them |

## 5. Audit items: coverage and conformance

| Item | Fixed on the branch by | Matches the PRD? | Test |
|---|---|---|---|
| C1 name views | `company_names` + `security_invoker` views; SELECT only | Partly: visitors can still read business names | Local ✓, staging written |
| A1 trial reset | Trial row created once per person, survives profile deletion | Yes in effect; FK target and statuses differ (section 4) | Local ✓ |
| A2 early reading | Bids readable by the business only after the tender is **closed** (`closed_at` set, within a minute of `closes_at`); bid files only after a logged download | Partly: the PRD logs "bids opened" **the first time the business views them**, which needs reads through a logging function | Local ✓ |
| A3 late or invalid bids | Trigger on direct `INSERT` | Rules yes; the PRD requires a **security-definer submit function** and `submitted_at` | Local ✓ |
| A4 file swap | No UPDATE or DELETE on bid files; bids immutable, even for the service role | Yes | Local ✓ |
| A5 Excel | `.xlsx` added; **`.xls` deliberately excluded** | **No**: the PRD requires XLS too. Add `application/vnd.ms-excel`. | Local ✓ (asserts the old choice; will change) |
| A6 date only, UTC | `closes_at timestamptz`; UI shows Jamaica time | Yes, apart from the backfill time (section 4) | Local ✓ + unit tests |
| A7 short names | Trigger falls back to the email name, then "New user" | Database yes; the **form still requires 2 to 120 characters**, but the AC says "any name length" | Local ✓ |
| A8 / M1 CHECK on every update | Removed | Yes | Local ✓ |
| A8 / M2 tender edits and deletes | Published terms fixed; only drafts deletable; bids survive tender deletion | **No**: after publishing the PRD allows **extending the closing time**, with every change audited | Local ✓ (asserts the old rule) |
| A8 / M3 public tender files | Signed-in only | Yes, and the PRD goes further: every tender needs an account | Local ✓ |
| A8 / M4 upload quota | 20 uploads per person per day; bid uploads need access | Number not in the PRD (Q9) | Local ✓ |
| A8 / M5 bid path not tied | Path must be in the bidder's folder and already uploaded | Superseded by the PRD's tender/bid path namespacing | Local ✓ |
| A8 / M6 RLS only barrier | Least-privilege grants; no default grants | Yes; must extend to every new table | Local ✓ |
| A8 / M7 definer functions executable | Execute revoked; orphan dropped | Yes | Local ✓ |
| A8 / M8 leaked-password protection | Not addressed (an Auth setting) | Goes in `DEPLOY.md`. It needs the Pro plan, so a free staging project can't test it. | None |

**Test bar:** the PRD wants each item proven against the local Supabase stack or staging, and every role tested against every table and bucket. Today's proof is the local emulation, which reproduces policies and grants but not PostgREST, the Storage API or real `pg_cron`. Stage 1 re-labels the tests by audit ID and runs the full suite on staging.

## 6. Security (PRD section 8) and Phase 1 requirements

| Requirement | State | Gap |
|---|---|---|
| 8.1 RLS everywhere, deny by default | Yes for current tables | Every new table |
| 8.2 No TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | Yes for `public` | `storage.objects` is Supabase-managed and grants these to `anon` and `authenticated` by default (Q10) |
| 8.3 Bids through a definer function | Direct INSERT + trigger | `submit_bid` function; revoke INSERT |
| 8.4 No user writes to status, subscriptions, audit, email log | Businesses change `tenders.status` directly; users can insert audit download rows | Lifecycle functions (`publish`, `extend closing time`, `cancel` with reason, `award`); no direct status or audit writes |
| 8.5 Storage namespaced by tender and bid, write-once, XLS, 60 s | Namespaced by **user ID**; write-once yes; no XLS; download gate allows **5 minutes** | Path scheme (Q11), XLS, 60-second gate |
| 8.6 Admin functions + MFA | None | Staff role + `aal2` checks |
| 8.7 Service role only in Edge Functions | Staging tests use it (Q4) | — |
| 8.8 Zod + DB constraints | Partly | Per new table and form |
| 8.9 Security Advisor zero errors | Unknown; needs staging | Stage 5 check |
| 8.10 Security headers | None | Railway and Cloudflare Pages config |
| P1-01 Accounts | Sign-up, sign-in, reset, add the other account type | Terms checkbox + `accepted_terms_at`; any-length names; Resend SMTP (`DEPLOY.md`); unconfirmed users can't sign in (Auth setting) |
| P1-02 Onboarding | — | All (Stage 4) |
| P1-03 Profiles | Yes | Names signed-in only |
| P1-04 Browse | Public list, no category filter, no pagination | Sign-in required, category filter, pagination |
| P1-05 Details | Public; one document; no countdown or category | Sign-in, countdown, category, multiple documents, requirements form |
| P1-06 Post and edit | Draft and publish, one document, no XLS | Category, multiple documents, XLS, requirements form, closing-time extension, audit of edits |
| P1-07 Lifecycle | Statuses + cron; cancel without reason; manual close button | Cancel reason; transitions only through functions; drop the manual close (cron plus read-on-closes_at makes it unnecessary) |
| P1-08 Bid | Amount + one required document; subscription-plans link for expired trials | Currency, proposal form, optional documents, submit function, contact-email message (Q12) |
| P1-09 Sealed bids | Yes, gated on close | Gate on `closes_at`; log the first view as "bids opened" |
| P1-10 My tenders / My bids | Dashboards with flat lists | Group or filter by status, history, all documents and forms |
| P1-11 Forms engine | — | All (Stage 4); PDF library choice (Q14) |
| P1-12 Site pages | Home only | About, Privacy, Terms from Markdown files (Q13) |
| P1-13 Emails | — | All (Stage 2) |
| P1-14 Audit log | Partial (section 4) | — |
| P1-15 Basic admin | — | All |
| P1-16 Quality | Not measured. One 733 kB JavaScript bundle (211 kB gzipped), which threatens the Lighthouse 90 target. | Code-splitting; checks in Stage 5 |
| 9.1 Monitoring | — | Sentry (Q15), uptime monitor |
| 9.2 Hosting | — | Railway SPA fallback + headers; same build on Cloudflare Pages |
| 10 Documents | — | `README.md`, `DEPLOY.md`; this file and `OPEN_QUESTIONS.md` now exist |
| 11 Tests | Local DB tests, unit tests | Staging RLS run, Playwright, CI, lint (Q16) |

## 7. On the branch but not in the PRD

I'll remove these in Stage 1 unless you want them kept:

- **Subscription page and plans list:** payments are Phase 3. The PRD's pilot shows a contact message instead.
- **Rewritten `private.process_subscription_payment`:** Phase 3. The production version writes columns that are being dropped, so it must be either dropped or rewritten (Q7).
- **Manual "Open the bids" button:** not needed once reads gate on `closes_at`.
- **A business cannot bid on its own tender:** a rule I added; the PRD doesn't mention it (Q6).
- **Upload quota of 20 per day:** my number for the M4 fix (Q9).
- **Old `.html` link redirects:** small, and needed for emails already sent by the old site. I'd keep this one.
- **`scripts/compare-staging-production.ts`:** breaks hard rule 1; delete.
- **Vitest:** already removed. **PGlite:** added without approval; keep only as a fast pre-check if you approve it (Q2).

## 8. Stage plan

Order and stop points follow PRD section 12. Each stage ends with a local commit on `phase-1` (`phase-2` for Stage 6) and a short report. Nothing is pushed.

| Stage | Work | Needs from you first | Stop? |
|---|---|---|---|
| **1. Database** | 1) Delete the production-reading script. 2) Rewrite the 11 unapplied rework migrations in place to match sections 4–6: profiles columns; `subscriptions` (auth-user key, PRD statuses, unchanged copy); `categories` (seeded with the legacy list as a draft); `tender_documents`; `bids` (currency, `submitted_at`, status); `bid_documents`; `form_definitions` (two draft rows) and `form_submissions`; restructured `audit_log`; `email_log`; `notification_preferences`; `staff_members`; name views for signed-in users only. 3) Functions: `submit_bid`, `publish_tender`, `extend_tender_closing_time`, `cancel_tender`, `award_tender`, `read_tender_bids` (logs the first view), document-download functions (log, then 60-second gate), and admin functions (list users and tenders, deactivate and reactivate, cancel tender; all check staff role and `aal2`). 4) Storage: tender/bid path namespacing, XLS, write-once, legacy-path rules. 5) `pg_cron` close job; the reminder schedule is wired up in Stage 2. 6) Data-migration rules from section 7 of the PRD. 7) Tests relabelled C1, A1–A8, plus a role × table × bucket matrix; run locally, then **on staging**; Security Advisor read on staging. | **Staging ref**, `.env.staging.local` filled in, and answers to Q1–Q12 (or acceptance of my defaults) | **Stop for review** |
| **2. Edge Functions** | `send-email` through Resend (test mode) with `email_log` idempotency; triggers or queue rows for bid receipt, new tender alert and bids opened; `pg_cron` + `pg_net` for the 24-hour reminder; the deactivate/reactivate function (Auth ban needs the service role); audit hooks | Resend test key in a local env file | Report |
| **3. Frontend** | Sign-in-only browsing, categories and pagination, details with countdown and multiple documents, post/edit with extension and cancel reason, bid via `submit_bid` with the contact message, My tenders and My bids with status filters and downloads, About/Privacy/Terms from Markdown, Terms checkbox, basic admin with MFA enrolment, code-splitting, regenerated types from staging; remove section 7 items | Q12, Q13 | Report |
| **4. Forms + onboarding** | Forms page driven by `form_definitions`, online filling, PDF generation, attaching to tenders and bids; guided tour per role with demo data only (no rows written) | Q14 | Report |
| **5. Release prep** | Playwright suite (PRD section 11 list), GitHub Actions (type-check, lint, unit, RLS), `README.md`, `DEPLOY.md` (backup, mark baseline applied, check whether the C1 fix was applied by hand, migrations, functions and secrets, Auth settings and SMTP, Resend DNS, domain, smoke tests, rollback), Railway and Cloudflare Pages config with headers, Lighthouse and Security Advisor checks | Q1 (mail catcher), Q15, Q16 | **Stop for review** |
| **6. Phase 2** | Branch `phase-2` from `phase-1`: staff roles and invites, supplier verification, user/tender/subscription management with trial extension, disputes, activity log with CSV export | — | Report |

## 9. Risks

- **Schedule:** 23 November is 10 days away. A realistic order is Stage 1 → 3 → 2 → 4 → 5. If time runs short, onboarding (P1-02) and the forms engine (P1-11) are the largest pieces to phase. The forms themselves haven't arrived from the client yet anyway.
- **Test environments:** without staging, nothing can be proven against real Supabase. Without Docker, the PRD's local stack and mail catcher aren't available.
- **Cutover:** the new schema breaks the legacy site, so the database and the new frontend must go live together (the PRD already says so). The C1 hole stays open in production until then, unless you apply `20261005031017` by hand first.
- **Production Auth Site URL** currently points at the Railway demo (section 2).
