# DEPLOY.md: production cutover (DRAFT)

**Status:** draft, started in Stage 1 with the steps the database work creates. Stage 5 completes it (Edge Functions and secrets, Auth email templates, Resend DNS, hosting and domain, smoke tests).

**Who runs it:** Tevin only, by hand. The coding agent never runs any of it (PRD hard rule 1).

**When:** in one cutover with the new frontend. These migrations change what the current static site relies on (PRD section 7).

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
| Subscription statuses the migration can copy unchanged | `select subscription_status, count(*) from public.supplier_profiles group by 1;` | Only `trial`, `active`, `expired` or `cancelled`. Anything else (including empty, or `canceled`) needs a decision first. |
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

## 6. Auth settings

| Setting | Value | Why |
|---|---|---|
| Site URL | `https://caribbeantender.com` | It was set to the Railway demo URL (`https://caribbeantender-production.up.railway.app/`) on 2026-10-07 for a presentation. |
| Redirect URLs | `https://caribbeantender.com/**` | Confirmation and reset links. Remove the Railway demo address. |
| Email confirmation | On | PRD P1-01 |
| Minimum password length | 8 | Matches the sign-up form |
| Leaked-password protection | On (Pro plan) | AUDIT.md M8 |
| MFA, authenticator app (TOTP) | Enabled | Admins (PRD P1-15, 8.6) |
| Custom SMTP | Resend (Stage 5 adds the details) | PRD P1-01 |

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

## 9. Rollback

Restore the backup from step 1 (point-in-time recovery to just before step 4, or the logical dump), then restore the Site URL. Stage 5 adds the frontend and Edge Function rollback.
