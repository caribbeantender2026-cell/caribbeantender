/** The browser's Supabase client. It only ever holds the publishable key. */
import { createClient } from '@supabase/supabase-js';
import { RecoverySession } from '../auth/recovery.ts';
import { publicSettingsProblem } from './publicSettings.ts';
import type { Database } from './database.types.ts';

const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL ?? '';
const publishableKey: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

/** Where people get help, for example when a trial has ended (OPEN_QUESTIONS.md, item 12). */
export const supportEmail: string = import.meta.env.VITE_SUPPORT_EMAIL || 'support@caribbeantender.com';

/** Shown on every page while the app is not connected; null once it is. */
export const configurationProblem = publicSettingsProblem(supabaseUrl, publishableKey);

// When misconfigured, the client points nowhere, so a secret key or production URL is never used.
export const supabase = createClient<Database>(
  configurationProblem ? 'http://not-configured.invalid' : supabaseUrl,
  configurationProblem ? 'not-configured' : publishableKey,
);

// Supabase reports PASSWORD_RECOVERY once, just after it reads a reset link on page load and often
// before the reset page has mounted, so it is recorded from the start.
export const recoverySession = new RecoverySession();
supabase.auth.onAuthStateChange((event, session) => recoverySession.observe(event, session));

/** Pin the password update and revocation to the verified recovery credentials.
 * The shared browser client may switch accounts while a request is in flight. */
export async function resetRecoveredPassword(password: string): Promise<void> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session || !recoverySession.matches(session)) throw new Error('Request a new password-reset link for this account.');
  const isolated = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: crypto.randomUUID() },
  });
  const pinned = await isolated.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (pinned.error) throw pinned.error;
  if (!recoverySession.matches(pinned.data.session)) throw new Error('The recovery session changed. Request a new link.');
  const updated = await isolated.auth.updateUser({ password });
  if (updated.error) throw updated.error;
  const revoked = await isolated.auth.signOut({ scope: 'global' });
  const current = await supabase.auth.getSession();
  const stillCurrent = recoverySession.matches(current.data.session);
  recoverySession.clear();
  if (stillCurrent) await supabase.auth.signOut({ scope: 'local' });
  if (revoked.error) throw new Error('Your password changed, but signing out other devices failed. Contact support.');
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
