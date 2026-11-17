/** The browser's Supabase client. It only ever holds the publishable key. */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';

const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL ?? '';
const publishableKey: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

/** Where people get help, for example when a trial has ended (OPEN_QUESTIONS.md, item 12). */
export const supportEmail: string = import.meta.env.VITE_SUPPORT_EMAIL || 'support@caribbeantender.com';

/** True when a key is a legacy service-role JWT, which bypasses every security rule. */
function isServiceRoleJwt(key: string): boolean {
  const payload = key.split('.')[1];
  if (!payload) {
    return false;
  }
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
    return claims.role === 'service_role';
  } catch {
    return false;
  }
}

/** Why the app cannot talk to Supabase, in plain English, or null when it is configured. */
function findConfigurationProblem(): string | null {
  if (!supabaseUrl || !publishableKey) {
    return 'Not connected to Supabase. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local (see .env.example), then restart pnpm dev.';
  }
  if (publishableKey.startsWith('sb_secret_') || isServiceRoleJwt(publishableKey)) {
    return 'VITE_SUPABASE_PUBLISHABLE_KEY holds a secret key, which must never reach a browser. Replace it with the publishable key and rotate the secret key.';
  }
  return null;
}

/** Shown on every page while the app is not connected; null once it is. */
export const configurationProblem = findConfigurationProblem();

// When misconfigured, the client points nowhere, so a secret key or production URL is never used.
export const supabase = createClient<Database>(
  configurationProblem ? 'http://not-configured.invalid' : supabaseUrl,
  configurationProblem ? 'not-configured' : publishableKey,
);

// Supabase reports PASSWORD_RECOVERY once, just after it reads a reset link on page load and often
// before the reset page has mounted, so it is recorded from the start.
let signedInFromResetLink = false;
supabase.auth.onAuthStateChange((authEvent) => {
  if (authEvent === 'PASSWORD_RECOVERY') signedInFromResetLink = true;
});

/**
 * Whether a password-reset link signed this tab in. Only then may the reset page set a password: any
 * other session could be someone else's on a shared computer, since a failed link keeps it signed in.
 */
export function cameFromResetLink(): boolean {
  return signedInFromResetLink;
}

/** Turns any thrown value into a message a person can act on. */
export function errorMessage(error: unknown): string {
  if (configurationProblem) {
    return configurationProblem;
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return 'Something went wrong. Check your connection and try again.';
}
