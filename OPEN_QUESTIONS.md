# Open questions

Questions found while building, per PRD hard rule 4. Each has the default I'll follow if there's no answer, so none of them blocks work. The client questions in PRD section 13 (forms, About Us, legal text, category list, Pro plan, Railway account, DNS, verification setting, withdrawals, contact email, C1 status, branding) are still open too and aren't repeated here.

Last updated: 13 November 2026 (Stage 0).

## Needed before Stage 1

1. **Test environments.** The PRD's local stack needs Docker; Docker is installed but its engine isn't running, and I haven't started it. The Playwright sign-up test needs the local mail catcher, which runs in that stack.
   *Default:* run the RLS suite on staging, and run the e-mail-confirmation test only once you've started Docker. If Docker stays off, the confirmation step is tested by hand.

2. **PGlite.** I added `@electric-sql/pglite` in October as a fast local Postgres for the database tests, before I knew new dependencies need approval.
   *Default:* keep it as a quick pre-check that runs in seconds; staging stays the real proof. Say no and I'll remove it and its harness.

3. **Comparing staging with production.** Hard rule 1 means I can't read production's settings.
   *Default:* check staging against the production values already recorded in `AUDIT.md` (Postgres 17.6.1.155, Auth v2.197.0, PostgREST v14.5, Storage v1.77.5, timezone UTC). For Auth settings, you export production's config yourself into a gitignored file if you want them compared.

4. **The staging secret key in tests.** The PRD keeps the service role key in Edge Functions only. The staging RLS suite needs a privileged way to create confirmed users and set up states such as an expired trial.
   *Default:* allow the **staging** secret key in `.env.staging.local`, for local test setup only. It's never committed, never used in the browser, and never a production key.

5. **How suppliers get a category for alerts.** The PRD sends tender alerts to "suppliers whose category matches", but its data model gives suppliers no category. Today they have a free-text `industry_category` chosen from 6 values.
   *Default:* add `category_id` to `supplier_profiles` and fill it from `industry_category` by name. Seed `categories` with the legacy 6 (Goods and Supplies, Works, Professional Services, Technology Services, Security Services, Cleaning and Janitorial), marked as a draft list pending the client's.

6. **A business bidding on its own tender.** One login can hold both account types, so a business could bid on its own tender with its supplier account. The PRD doesn't mention this.
   *Default:* keep the database rule that refuses it.

7. **Phase 3 leftovers.** `subscription_plans`, `subscription_events`, the `payment-webhook` stub and `private.process_subscription_payment` exist in production. The function writes subscription columns that this build removes.
   *Default:* keep the two tables and the stub untouched; drop the function (Phase 3 will design payments anew). Copy the existing plan and payment IDs into nullable `subscriptions` columns, so nothing is lost.

8. **Bid status values.** The PRD adds `bids.status` without listing the values.
   *Default:* `submitted`, then `awarded` or `unsuccessful`, set only by the award and cancel functions.

9. **Upload quota.** Fixing M4 needs a limit; the PRD doesn't give one.
   *Default:* 20 uploads per person per day, per bucket.

10. **Grants on `storage.objects`.** Supabase itself grants `anon` and `authenticated` everything on this table, including TRUNCATE, REFERENCES, TRIGGER and MAINTAIN, which PRD 8.2 rules out "anywhere". It's owned by Supabase's storage role, so our migrations may not be allowed to revoke them.
    *Default:* try the revoke on staging. If Supabase refuses it, document it as a platform exception (RLS still applies to every row).

11. **Storage path scheme.** PRD 8.5 wants paths namespaced by tender and bid ID.
    *Default:* `tender-documents/{tender_id}/{file}` and `bid-documents/{tender_id}/{bid_id}/{file}`. The browser picks the bid ID before uploading, and `submit_bid` uses the same ID. Existing files stay at their old `{user_id}/...` paths, with read rules that cover them.

12. **Contact email for expired trials** (PRD section 13, item 10). I need the address, and a place to set it.
    *Default:* a build setting `VITE_SUPPORT_EMAIL`, set to `support@caribbeantender.com` until you confirm. The site's top bar still says `support@example.com` and will use the same setting.

## Needed before Stages 3 to 5

13. **Rendering the Markdown pages.** About, Privacy and Terms are stored as Markdown files, which need a renderer. The PRD doesn't name one.
    *Default:* ask you to approve `marked` (small, no other dependencies). Otherwise I'll write a minimal renderer for headings, paragraphs, lists and links.

14. **PDF library and where PDFs are made.** The PRD allows pdf-lib or @react-pdf/renderer.
    *Default:* pdf-lib, generated in the browser from the saved form data, stored at `pdf_path`, and immutable once attached. The saved data is the record; the PDF is a rendering of it.

15. **Sentry.** This needs a Sentry project and DSN, in the client's account or yours.
    *Default:* wire it up with the DSN read from configuration, so it does nothing until a DSN is set.

16. **Lint tool.** The PRD's CI runs lint but doesn't name a tool.
    *Default:* ask you to approve ESLint with typescript-eslint and the React Hooks plugin.

## Rules where the PRD and the branch differ (I'll follow the PRD)

17. **When bids open.** The branch waits for the tender to be closed (within a minute of `closes_at`, or when the business closes it). The PRD opens bids at `closes_at` and logs the business's first view as "bids opened".
    *Default:* follow the PRD. Reads go through a function that logs the first view, and the manual "Open the bids" button goes.

18. **Who can see company names.** The branch shows business names to visitors and hides supplier names until bids open. The PRD says signed-in users only.
    *Default:* every signed-in user can read every company name (name and ID only). A name alone doesn't show who bid on what.

19. **Admins and bids after closing.** PRD P1-15 hides bid contents from admins "before closing" and is silent about after.
    *Default:* admins never see bid amounts, forms or files in Phase 1.

20. **Cancelling.** PRD P1-07 lets the business cancel an open tender, and its status list allows `closed → cancelled`.
    *Default:* cancel from `open` or `closed`, with a reason. Drafts are deleted, not cancelled.

21. **Deactivating a user.** P1-15 asks for deactivate and reactivate, without saying how it's enforced.
    *Default:* the admin function sets `profiles.is_active` and an Edge Function bans the Auth user, which blocks sign-in and token refresh. Existing sessions end when their access token expires (1 hour by default).

22. **Terms acceptance for existing users.** `accepted_terms_at` is new.
    *Default:* recorded at sign-up from the required checkbox; left empty for existing users and dashboard-created users. Asking existing users to accept on their next sign-in isn't in the PRD, so I won't build it.

23. **Name length on the form.** The P1-01 AC says sign-up works with any name length, but the form requires 2 to 120 characters.
    *Default:* the form accepts any non-blank name; the database keeps the first 120 characters.

## Schedule

24. **Phase 1 by 23 November.** That's 10 days for Stages 1 to 5, and the client's forms, legal text and categories haven't arrived.
    *Default:* build in the order Stage 1 → 3 → 2 → 4 → 5, and tell you early if onboarding or the forms engine won't make the date.
