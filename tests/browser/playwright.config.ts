import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const baseURL = 'http://127.0.0.1:54391';
export default defineConfig({
  testDir: '..',
  testMatch: ['**/browser/*.spec.ts', '**/e2e/home.spec.ts', '**/e2e/password-visibility.spec.ts'],
  timeout: 90_000,
  workers: 2,
  reporter: 'list',
  use: { baseURL, channel: 'chrome' },
  webServer: {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 54391 --strictPort',
    url: baseURL,
    env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54392', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_browser_fixture', VITE_SENTRY_DSN: '' },
  },
});
