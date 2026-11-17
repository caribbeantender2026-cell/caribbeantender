# CaribbeanTender

Electronic tendering for private-sector businesses and suppliers in the Caribbean. Businesses post tenders; suppliers submit sealed bids that nobody can read before the closing time.

**Stack:** React 19, Vite, TypeScript, TanStack Query, React Hook Form and Zod, on Supabase (Postgres with row-level security, Auth, Storage, Edge Functions, `pg_cron`). Emails go through Resend.

**Documents:** kept out of the repository, because it is public and the security audit must not be. `PRD.md` (the requirements) is in the project root; the rest are in a local `docs/` folder. Both are gitignored: `GAP.md` (Stage 0 plan), `OPEN_QUESTIONS.md` (open questions and decisions D1 to D3), `DEPLOY.md` (what was done on the client's project and what is left) and `AUDIT.md` (the October 2026 security audit). Ask Tevin for a copy.

## Setup

Requires Node 22.18 or later, pnpm 10 (`corepack enable`), and the Supabase CLI. Never use npm in this repo.

```powershell
pnpm install
supabase link --project-ref <client project ref>   # needed by the type generator and the live scripts
```

Copy the blocks of `.env.example` into the files it names. All of them are gitignored.
- `.env.local`: the app. Only the publishable key goes here.
- `.env.production.local`: scripts only, including the secret key. Never print or commit it.

There is no staging project (`docs/OPEN_QUESTIONS.md`, decision D1): the app and the live tests use the client's project, which isn't live yet.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | The app on http://localhost:5173 |
| `pnpm build` | Type checks, then builds `dist/` |
| `pnpm types` | Regenerates `src/lib/database.types.ts` from the linked project. Run it after every migration. |
| `pnpm test` | Unit tests: app rules, forms, PDFs, the static server, email allowlist and email wording |
| `pnpm test:database` | The database rules on PGlite, an in-memory Postgres (no Docker needed) |
| `pnpm test:database:before-after` | Proves every fix fails before its migration and passes after it |
| `pnpm test:rls:live` | The RLS suite and role-by-table matrix against the client's project. Its test accounts are named `rls-test-<run id>`, created already confirmed; everything is removed afterwards. Writes a record to `tests/rls/runs/`. |
| `pnpm test:e2e` | Playwright end-to-end flow in the installed Google Chrome, against the client's project. It cleans up the same way. |

Test run records are written only by the runner. Never edit them by hand.

## Code layout

- `supabase/migrations/`: every database change, applied one at a time with `supabase db push --linked` after committing.
- `supabase/go-live/`: migrations kept back until go-live (`docs/DEPLOY.md` step 11).
- `supabase/functions/`: Edge Functions.
  - `download-document`: 60-second download links.
  - `send-notifications`: emails, called by `pg_cron` every minute.
  - `set-user-active`: deactivation with an Auth ban.
  - `_shared/email.ts`: the allowlist sender.
- `src/`: the app. Pages are under `src/pages`, shared rules under `src/lib`, and site text under `src/content/*.md`.
- `scripts/`: backups, cleanup, the RLS runner, type generation and the Railway static server.
- `tests/`: `app` and `functions` (Node unit tests), `database` (PGlite), `rls` (live), `e2e` (Playwright).

## Working rules

- Never push. Pushing is disabled in this clone (`git remote set-url --push origin DISABLED`), because the repo is public and `.env.production.local` holds the live secret key.
- Never change or delete the existing users or their tenders, bids or files. Anything made for testing uses the `rls-test-` prefix and is removed at the end.
- No email reaches a real user before go-live: `EMAIL_ALLOWLIST` (`docs/DEPLOY.md` step 9).

Deployment, hosting, Auth settings and go-live: see `docs/DEPLOY.md`.
