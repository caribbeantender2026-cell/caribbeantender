# Open questions

Questions found while building, per PRD hard rule 4. The client questions in PRD section 13 (forms, About Us, legal text, category list, Pro plan, Railway account, DNS, verification setting, withdrawals, contact email, C1 status, branding) are still open and aren't repeated here.

Last updated: 13 November 2026 (Stage 1).

## Open

25. **Is the requirements form required to publish?** PRD P1-06 lists it among a tender's fields.
    *Resolved (Tevin, 13 November 2026):* yes. `publish_tender` refuses a draft without one, filled in online or uploaded under `requirements-form/`.

26. **Awarding straight after the deadline.** `award_tender` needs the status `closed`, which the scheduled job sets within a minute of `closes_at`. The business can read the bids from `closes_at`, but must wait up to a minute to award.
    *Default:* keep it; the UI says "closing…" for that minute.

27. **What deactivation blocks.** A deactivated user can't use any write function, create or edit drafts, fill in forms or upload. Reads stay possible until the Auth ban (Stage 2) ends their session.
    *Default:* as described.

28. **Bid file uploaded at the moment of submission.** If a supplier's upload commits at the same instant their own `submit_bid` does, the file can land in the folder without being recorded on the bid. It's never shown or downloadable, because downloads go through the recorded documents.
    *Default:* accept it (harmless); a cleanup job can remove such files later.

29. **`subscription_events` cascade.** Kept untouched (item 7), so it still deletes a supplier's events if their supplier profile is deleted. Profiles can't be deleted through the API, so only the owner could trigger it.
    *Default:* leave it until Phase 3 designs payments.

30. **Names over 120 characters at sign-up.** The database refuses them (item 23), and Supabase Auth then reports a generic "Database error saving new user". The form stops such names first, so users won't see it.
    *Default:* accept it.

31. **TOTP on the client's project.** The admin tests enrol an authenticator factor, so TOTP MFA must be enabled.
    *Answered:* it is. The live run on 13 November 2026 enrolled and verified a factor (`tests/rls/runs/`). The client's owner should keep it on (DEPLOY.md step 6).

32. **Length of the go-live trial.** None of the 6 existing suppliers can bid today (4 expired, 2 with trials that ended in October). At go-live a one-off migration gives every existing supplier a fresh trial (DEPLOY.md step 10).
    *Default:* 14 days from go-live. Tevin confirms with the client.

33. **Deadline reminders and the alerts setting.** PRD P1-13 lets users turn off *tender alerts*; it doesn't say whether that also stops the 24-hour reminders.
    *Default:* yes, turning alerts off stops reminders too (fewer unwanted emails). Reminders are only sent for tenders published more than a day before closing, so they never arrive together with the alert.

34. **Proving real delivery.** Sending is built and running, but nothing has been delivered yet. `RESEND_API_KEY` and `EMAIL_ALLOWLIST` aren't set, and the agent's login can't set Edge Function secrets.
    *Default:* the client's Owner sets both (DEPLOY.md step 9) with the test inboxes Tevin chooses. Then one live run shows a real receipt arriving.

## Decisions that change the PRD

- **D1 (Tevin, 13 November 2026): work directly on the client's Supabase project.** No staging and no Docker. Stage 1 is applied to and tested on the client's project (`ijlcjthgwppllhlqocep`), which isn't live yet; Tevin accepts the risk. This **replaces PRD hard rule 1** ("never connect to the production project") and the staging plan (PRD 9.3, OPEN_QUESTIONS items 1, 3 and 4). Limits that still apply on that project:
  - never reset, drop or recreate the database;
  - never delete real users, rows or files;
  - never send email to real users;
  - never change Auth or project settings (Tevin's Developer role can't; DEPLOY.md lists what the client's owner must set);
  - back up first;
  - test accounts are named `rls-test-<run id>`, created already confirmed, and deleted afterwards with all their rows and files.

- **D2 (Tevin, 13 November 2026): suppliers with no subscription status become expired.** Four suppliers on the client's project were created (4 August to 10 September) before trials existed, have no status and no trial dates, and can't bid today. The subscriptions migration copies them as `expired`, so nobody gains or loses access; any other unknown status still stops the migration.

- **D3 (Tevin, 13 November 2026): no email to real users before go-live.** Every Edge Function sends through `supabase/functions/_shared/email.ts`, which checks the `EMAIL_ALLOWLIST` setting. An address outside it is logged in `email_log` as `suppressed` and not sent. One change to the wording asked for: at go-live the setting becomes `*` rather than being removed, because a missing or empty setting sends nothing (safety first, CLAUDE.md precedence 1). Push from this clone is disabled (`git remote set-url --push origin DISABLED`), because the repo is public and `.env.production.local` holds the live secret key.

## Resolved (Tevin, 13 November 2026)

| # | Question | Decision |
|---|---|---|
| 1 | Test environments | Docker is running. Use the local Supabase stack for development and for the sign-up confirmation test (local mail catcher). Run the RLS suite on **both** the local stack and staging. |
| 2 | PGlite | Keep as a quick pre-check. Staging stays the proof. |
| 3 | Staging vs production | Compare staging with the production values recorded in `AUDIT.md`. Record staging's versions with each test run. |
| 4 | Secret key in tests | Approved: the **staging** secret key, only in `.env.staging.local`, never committed, never in browser code. |
| 5 | Supplier category | A single `category_id` on `supplier_profiles`, filled from `industry_category`; `categories` seeded with the 6 legacy categories, marked as a draft list. |
| 6 | Bidding on your own tender | Keep refusing it. |
| 7 | Phase 3 leftovers | Drop `private.process_subscription_payment`. Keep `subscription_plans` and `subscription_events`. Copy plan and payment IDs into nullable `subscriptions` columns. Check, from the repo only, whether the `payment-webhook` stub is deployed, and add a `DEPLOY.md` step to delete it from production so no public endpoint can write to subscriptions. |
| 8 | Bid status | `submitted` → `awarded` or `unsuccessful`, set by the award function. Cancelling a tender sets `tender_cancelled`, never `unsuccessful`. |
| 9 | Upload quota | 20 uploads per person per day, per bucket. |
| 10 | `storage.objects` grants | Try the revoke on staging. If Supabase refuses it, document it as a platform exception. |
| 11 | Storage paths | `tender-documents/{tender_id}/…` and `bid-documents/{tender_id}/{bid_id}/…`, with two checks: `submit_bid` verifies that every file under the bid's path was uploaded by the caller, and no uploads to a bid's path are allowed once the bid is submitted. |
| 12 | Support email | `VITE_SUPPORT_EMAIL`, set to `support@caribbeantender.com`, replacing `support@example.com` everywhere. Tevin confirms the address with the client. |
| 13 | Markdown | `react-markdown` (no raw HTML without a plugin, so no `innerHTML`). |
| 14 | PDFs | pdf-lib, generated from the saved form data **at download time**, never stored. `pdf_path` is dropped. |
| 15 | Sentry | Wired to a DSN from configuration; does nothing until a DSN is set. |
| 16 | Lint | ESLint with typescript-eslint and the React Hooks plugin. |
| 17 | When bids open | Follow the PRD: readable from `closes_at`, through a function that logs the business's first view as "bids opened". |
| 18 | Company names | Every signed-in user can read every company name (name and ID only). |
| 19 | Admins and bids | No bid contents for admins in Phase 1. **Phase 2 note:** staff will need to view a bid after closing when it's part of a dispute. |
| 20 | Cancelling | From `open` or `closed`, with a reason. Drafts are deleted, not cancelled. |
| 21 | Deactivation | `profiles.is_active`, plus an Auth ban from an Edge Function. **Every write function** (`submit_bid`, publish, extend, cancel, award) also checks `is_active`, so a deactivated user can't act while their token is still valid. |
| 22 | Terms acceptance | Recorded at sign-up; empty for existing and dashboard-created users; no re-prompt. |
| 23 | Name length | 1 to 120 characters. The form shows the limit and the database enforces it with a constraint. No silent truncation. |
| 24 | Schedule | Build order 1 → 3 → 2 → 4 → 5. On **19 November**, report whether the forms engine and onboarding will make 23 November. |
