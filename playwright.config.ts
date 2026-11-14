/**
 * End-to-end tests in a real browser (PRD section 11), against the client's project (OPEN_QUESTIONS.md,
 * decision D1): the app runs locally from .env.local, test accounts are rls-test-<run id>, created
 * already confirmed, and everything the run creates is removed afterwards (tests/e2e/teardown.ts).
 *
 * Usage: pnpm test:e2e (needs .env.production.local and .env.local, and Google Chrome installed).
 */
import { defineConfig } from '@playwright/test';

const port = 5199;
process.loadEnvFile('.env.production.local');
// Set once in the main process; the test workers inherit it, so every part of the run shares one id.
process.env.RLS_RUN_ID ??= new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
process.env.RLS_TARGET = 'live';
process.env.RLS_LIVE_PROJECT = 'after-state-only';
process.env.RLS_SUPABASE_URL = process.env.PRODUCTION_SUPABASE_URL;
process.env.RLS_PUBLISHABLE_KEY = process.env.PRODUCTION_SUPABASE_PUBLISHABLE_KEY;
process.env.RLS_SECRET_KEY = process.env.PRODUCTION_SUPABASE_SECRET_KEY;

export default defineConfig({
  testDir: 'tests/e2e',
  globalTeardown: './tests/e2e/teardown.ts',
  workers: 1,
  // The flow waits for a real closing time and the one-minute close job.
  timeout: 8 * 60 * 1000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, channel: 'chrome', headless: true, acceptDownloads: true },
  webServer: { command: `pnpm exec vite --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: false, timeout: 120_000 },
});
