# DEPLOY.md: production cutover (DRAFT)

**Status:** complete for Phase 1 as of Stage 5 (2026-11-13). What is left needs the client's Owner or Administrator (steps 6 and 9), the hosting and DNS (step 10), and go-live day (step 11).

**Who runs it:** decision D1 in OPEN_QUESTIONS.md replaced PRD hard rule 1. The coding agent works directly on the client project, which isn't live yet. Steps 1 to 5 were run on 2026-11-13 (see "Done on 2026-11-13" below). Step 6 needs the client's Owner or Administrator, because Tevin's Developer role can't change Auth or project settings.

**The current static site:** it no longer works against the migrated database (PRD section 7). The new frontend replaces it at cutover.

## Done on 2026-11-13

| Step | Result |
|---|---|
| 1. Backup | Every public table, the auth users (id, email, created_at, metadata) and the list of stored files exported as JSON to `backups/2026-11-13/` (gitignored, kept on Tevin's machine). Supabase's own daily backup is the restore point. |
| 2. Pre-checks | Every check passed. 4 suppliers had no subscription status; they became `expired` (OPEN_QUESTIONS.md, D2). |
| 3. C1 fix | Not applied by hand, so `20261005031017` was pushed with the rest. |
| 4. Migrations | `20261005025300` marked applied; `20261005031017` and `20261005040050` to `20261005041100` applied one at a time, with no failures. `20261113230000` (email_log `suppressed`) and `20261114010000` (email sending: `due_emails`, `pg_net`, the `send-notifications` cron job) were each committed, then applied on their own the same day. |
| 5. payment-webhook | Deleted; a POST now returns 404. |
| Edge Functions | Deployed with `supabase functions deploy <name> --project-ref <production ref> --use-api`; redeploy after changing one. `download-document` (Stage 3) signs 60-second download links after `request_document_download` checks and logs the request. `send-notifications` (Stage 2, deployed with `--no-verify-jwt`; it checks the Vault secret instead) sends the due emails (step 9). `set-user-active` (Stage 2) records a deactivation as the admin, then bans or unbans the account in Auth. |
| Checks after | Security Advisor: 0 errors, 13 warnings (12 intended signed-in remote procedures, plus leaked-password protection off), 1 info. The RLS suite passed 26 of 26 against the project (`tests/rls/runs/2026-11-14T03-31-02-116Z-live.md`); its `rls-test-<run id>` accounts, rows and files were removed, and every existing table's row count matches the backup. |

## 1. Backup

1. In the production dashboard, go to **Database → Backups** and confirm the latest daily backup exists. On the Pro plan, also note the point-in-time-recovery window.
2. Take a logical dump as a second copy, from a machine with the production database password:
   ```powershell
   supabase db dump --db-url "<production connection string>" -f backup-schema.sql
   supabase db dump --db-url "<production connection string>" --data-only -f backup-data.sql
   ```
3. Download the Storage files of `tender-documents` and `bid-documents` (dashboard, or `supabase storage cp -r`), so files survive a restore.

## 2. Read-only pre-checks

Run each query in the production **SQL Editor**. Each must return the stated result before you go on, because a migration stops rather than guessing.

| Check | Query | Must return |
|---|---|---|
| Subscription statuses the migration can copy unchanged | `select subscription_status, count(*) from public.supplier_profiles group by 1;` | Only `trial`, `active`, `expired`, `cancelled` or empty. Empty becomes `expired` (OPEN_QUESTIONS.md, D2); anything else (such as `canceled`) needs a decision first. |
| Suppliers active with no end date, to review | `select supplier.user_id, supplier.company_name, supplier.contact_email, supplier.subscription_started_at, supplier.updated_at from public.supplier_profiles supplier where supplier.subscription_status = 'active' and supplier.subscription_ends_at is null order by supplier.updated_at;` | Review every row. They keep access after the cutover (no end date counts as active), and a supplier may have given themselves access through the October holes (AUDIT.md C1). |
| No two bids share a file | `select document_path, count(*) from public.bids group by 1 having count(*) > 1;` | No rows |
| No two tenders share a file | `select document_path, count(*) from public.tenders where document_path is not null group by 1 having count(*) > 1;` | No rows |
| Names fit 1 to 120 characters | `select id from public.profiles where char_length(btrim(full_name)) not between 1 and 120;` | No rows |
| Row counts before | [audit/row-counts.sql](audit/row-counts.sql) | Save the output to compare in step 8 |

## 3. Is the C1 fix already applied? (PRD section 13, item 11)

In the SQL Editor, run check 1 from [audit/verify-name-view-fix.sql](audit/verify-name-view-fix.sql). If `can_insert`, `can_update` and `can_delete` are all `false`, `20261005031017` was applied by hand.

## 4. Mark the baseline as applied, then apply the migrations

The baseline migration is already in production but not in its migration history. It must be marked, never pushed.

```powershell
supabase link --project-ref <production ref>
supabase migration repair --status applied 20261005025300 --linked
# Only if step 3 showed the C1 fix is already applied:
supabase migration repair --status applied 20261005031017 --linked
supabase db push --linked --dry-run   # check the list: every migration from 2026100503/04xxxx, nothing earlier
supabase db push --linked
supabase unlink
```

`20261005040500_tender_lifecycle.sql` enables `pg_cron` and schedules `close-expired-tenders` every minute. Check it under **Integrations → Cron**.

## 5. Delete the payment-webhook Edge Function (OPEN_QUESTIONS.md, item 7)

`AUDIT.md` recorded `payment-webhook` (version 1) as deployed in production on 2026-10-05. It is a locked stub that returns 405 or 503 and writes nothing, but payments are Phase 3 and no public endpoint may exist that could later write to `subscriptions`. Its source is no longer in the repository, so a later `supabase functions deploy` won't bring it back.

1. **Edge Functions → payment-webhook → Delete** in the dashboard, or `supabase functions delete payment-webhook --project-ref <production ref>`.
2. Confirm it is gone. This must return **404**:
   ```powershell
   curl.exe -s -o NUL -w "%{http_code}" -X POST https://<production ref>.supabase.co/functions/v1/payment-webhook
   ```

## 6. Settings the client's Owner or Administrator must set

Tevin's Developer role can't change these. "Now" is what the project showed on 2026-11-13, where it could be read.

| # | Where in the dashboard | Setting | Value | Now | Why |
|---|---|---|---|---|---|
| 1 | Organization → Billing | Plan | **Pro**, in the business's name, with Tevin as Administrator | Unknown | PRD 9.3 and 13.5. Free projects pause after a week without activity, and leaked-password protection needs Pro. |
| 2 | Authentication → Emails → SMTP Settings | Custom SMTP | Host `smtp.resend.com`, port `465`, username `resend`, password: a Resend API key with sending access only; sender `no-reply@caribbeantender.com`, name `CaribbeanTender` | Built-in sender | PRD P1-01. The built-in sender only reaches the project's team members, about 2 emails an hour, so real users would get no confirmation or reset emails. Needs the Resend domain verified first (SPF and DKIM on caribbeantender.com; Stage 5). |
| 3 | Authentication → Rate Limits | Emails sent per hour | At least 30 (the default once custom SMTP is on); raise it before launch announcements | Unknown | Sign-up and reset emails share this limit. |
| 4 | Authentication → URL Configuration | Site URL | `https://caribbeantender.com` | Railway demo URL, set 2026-10-07 | Links in Auth emails point here. |
| 5 | Authentication → URL Configuration | Redirect URLs | `https://caribbeantender.com/**`; remove the Railway demo address | Unknown | Confirmation and reset links may only return to these. |
| 6 | Authentication → Sign In / Providers → Email | Confirm email | On | On | PRD P1-01: an unconfirmed user cannot sign in. |
| 7 | Authentication → Sign In / Providers → Email | Minimum password length | 8 | Unknown (Supabase's default is 6) | Matches the sign-up form. |
| 8 | Authentication → Sign In / Providers → Email | Secure email change, secure password change | On | Unknown | A stolen session alone can't take over the account. |
| 9 | Authentication → Sign In / Providers → Email | Email OTP expiry | 3600 seconds (the default) | Unknown | PRD P1-01: reset links expire. |
| 10 | Authentication → Attack Protection | Leaked-password protection | On (Pro plan) | Off (Security Advisor warning) | AUDIT.md M8. |
| 11 | Authentication → Multi-Factor | Authenticator app (TOTP) | Enabled | Enabled (the RLS run enrolled and verified a factor) | Admins need it (PRD P1-15, 8.6). |
| 12 | Authentication → Sign In / Providers | Allow new users to sign up: on. Anonymous sign-ins: off. Only the Email provider enabled. | As stated | As stated | PRD P1-01. |
| 13 | Authentication → Emails → Templates | Confirm signup, Reset password, Change email address | Stage 5 supplies the wording | Supabase defaults | PRD 10. |
| 14 | Project Settings → API Keys | Rotate the secret (`service_role`) key at handover, and later move to the new publishable and secret keys | Recommended | Legacy keys in use | The secret key was copied to Tevin's machine for this work (`.env.production.local`). Rotating it also signs everyone out, so do it at cutover. |

## 7. First admin

1. The admin signs up on the new site, confirms their email, then enrols an authenticator app (the admin page prompts for it).
2. Add them in the SQL Editor:
   ```sql
   insert into public.staff_members (user_id, role)
   select id, 'admin' from auth.users where email = '<admin email>';
   ```

## 8. Checks after migrating

- **Row counts:** run [audit/row-counts.sql](audit/row-counts.sql) again. Every table that existed before has the same number of rows; new tables (`subscriptions`, `company_names`, `tender_documents`, `bid_documents`, …) match their sources.
- **Security Advisor:** **zero errors** (PRD 8.9). Expected warnings: the intended remote procedures (`submit_bid`, `publish_tender`, `admin_*`, …) are security-definer functions callable by signed-in users, which is how the PRD wants them; each checks the caller itself.
- **Smoke tests:** Stage 5 adds these.

## 9. Emails (Stage 2) and email safety until go-live (OPEN_QUESTIONS.md, D3)

**How it works:** every minute `pg_cron` calls the `send-notifications` Edge Function through `pg_net`, with a shared secret. `public.due_emails` decides what is due: bid receipts, new tender alerts, 24-hour reminders and bids opened. Each email goes through `email_log`, so it goes out at most once.

**Done on 2026-11-13:**
- `send-notifications` and `set-user-active` are deployed.
- Vault holds `send_notifications_url` and `send_notifications_cron_secret`. The secret was generated randomly and isn't kept anywhere else.
- The first call returned 200 with nothing due.

**Edge Function settings.** The coding agent's CLI login can't manage these (`supabase secrets` says no access token), so the client's Owner or Administrator sets them, under **Edge Functions → Secrets** or with the CLI:

| Setting | Until go-live | At go-live |
|---|---|---|
| `EMAIL_ALLOWLIST` | The test inboxes only, comma-separated. Missing or empty sends **nothing**. | `*` (step 11) |
| `RESEND_API_KEY` | A Resend key with sending access only. Without it, allowed emails are logged as `failed`. | Same |
| `EMAIL_FROM` | Optional. Default `CaribbeanTender <no-reply@caribbeantender.com>`; the domain must be verified in Resend. | Same |
| `SITE_URL` | Optional. Default `https://caribbeantender.com`; used for links in emails. | Same |

```powershell
supabase secrets set EMAIL_ALLOWLIST="<test inbox 1>,<test inbox 2>" RESEND_API_KEY="<key>" --project-ref <production ref>
```

An email to any address outside the allowlist is recorded in `email_log` as `suppressed` and never sent, so publishing a test tender can't email a real supplier.

**Moving to a new project (or after a restore that lost Vault):** create both Vault entries once, in the SQL Editor:
```sql
select vault.create_secret('https://<project ref>.supabase.co/functions/v1/send-notifications', 'send_notifications_url');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'send_notifications_cron_secret');
```

**Check it is running:**
```sql
select status_code, content, created from net._http_response order by created desc limit 5;  -- 200 with counts
select type, status, count(*) from public.email_log group by 1, 2;
```

## 10. Hosting, domain and email DNS

**Build settings (either host).**
- Build command `pnpm build`, output `dist/`, Node 22.18 or later.
- Build-time variables, the same as `.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (the publishable key, never the secret one), `VITE_SUPPORT_EMAIL`, and optionally `VITE_SENTRY_DSN`.

**Security headers (PRD 8.10)** are in `public/_headers`, copied to `dist/`.
- Headers: CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options` and `Permissions-Policy`.
- The CSP allows connections only to this project (`https://ijlcjthgwppllhlqocep.supabase.co`) and Sentry. **If the Supabase project ever changes, update the address in `public/_headers`.**

| Host | Setup |
|---|---|
| Railway | `railway.json` builds with `pnpm build` and starts `node scripts/serve-static.ts`. That server needs no dependencies: it serves `dist/`, answers every app route with `index.html`, and applies `dist/_headers` to every response. |
| Cloudflare Pages | Framework "None", build `pnpm build`, output `dist`. Pages reads `dist/_headers` and `dist/_redirects` (every route goes to `index.html`) by itself. |

**Domain:** point `caribbeantender.com` (and `www`, redirected to it) at the host, with HTTPS on. Then set the Auth Site URL and redirect URLs (step 6, rows 4 and 5).

**Resend DNS (PRD P1-01, P1-13):**
1. In Resend, add the domain `caribbeantender.com`.
2. At the DNS provider, add the SPF (TXT) and DKIM (TXT or CNAME) records Resend shows; optionally add a DMARC record (`_dmarc`, TXT, `v=DMARC1; p=none;` to start).
3. Wait until Resend shows the domain as verified.
4. Set custom SMTP (step 6, row 2) and the Edge Function settings (step 9).

**Checks after deploying:**
- Open `/` and `/tenders`. A visitor is sent to sign in.
- `curl.exe -sI https://caribbeantender.com/tenders` shows the security headers.
- Sign in as a test business and a test supplier, then repeat the end-to-end flow by hand: post, bid, closing, award, downloads, a form PDF.
- `pnpm test:e2e` and `pnpm test:rls:live` pass against the project. Both clean up after themselves.
- Security Advisor: zero errors.

## 11. Go-live

Run these in order on go-live day, after the new frontend is live.

1. **Fresh supplier trials** (OPEN_QUESTIONS.md, item 32: confirm the 14 days with the client first). None of the 6 existing suppliers could bid on 2026-11-13. This gives every existing supplier a trial ending 14 days after go-live; a paid subscription that is still running is left alone. It is a migration, never run by hand:
   ```powershell
   # <go-live timestamp>: go-live day as YYYYMMDDHHMMSS, later than every file in supabase/migrations.
   Copy-Item supabase/go-live/fresh_supplier_trials.sql supabase/migrations/<go-live timestamp>_fresh_supplier_trials.sql
   git add supabase/migrations; git commit -m "Go-live: fresh supplier trials"
   supabase db push --linked --dry-run   # must list only this migration
   supabase db push --linked
   ```
   Check that every supplier can bid; this must return `0`:
   ```sql
   select count(*) from public.supplier_profiles supplier where not private.supplier_has_access(supplier.user_id);
   ```
2. **Turn on email for everyone:**
   ```powershell
   supabase secrets set EMAIL_ALLOWLIST="*" --project-ref <production ref>
   ```
   This replaces the allowlist rather than deleting the setting, because an empty or missing setting sends nothing (step 9). Emails suppressed before go-live stay suppressed, so nobody gets a backlog of test-period emails.

## 12. Rollback

| What went wrong | Undo |
|---|---|
| Emails going where they shouldn't | Set `EMAIL_ALLOWLIST` to empty: nothing is sent from the next minute on. To stop the job entirely: `select cron.unschedule('send-notifications');` |
| A frontend deploy | Railway: **Deployments → the previous deployment → Rollback**. Cloudflare Pages: **Deployments → the previous one → Rollback to this deployment**. |
| An Edge Function | Check out the previous commit and deploy that function again (`supabase functions deploy <name> --project-ref <production ref> --use-api`). |
| The go-live trials | Set the trial end dates back in the Table Editor (`subscriptions`). They are dates only, and no other data changes. |
| The database | Restore the backup from step 1 (point-in-time recovery to just before the change, or the logical dump). Then set the Site URL back. The exported JSON in `backups/2026-11-13/` is the record of every row and file as they were before the migrations. |
