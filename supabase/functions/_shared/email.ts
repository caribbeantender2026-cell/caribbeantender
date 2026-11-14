/**
 * Sends the platform's emails (PRD P1-13) through email_log, so each goes out at most once, and only
 * to addresses on EMAIL_ALLOWLIST until go-live (OPEN_QUESTIONS.md, decision D3). Every Edge Function
 * that emails goes through sendEmail; Stage 2 connects it to Supabase and Resend.
 */

export type EmailType = 'bid_receipt' | 'new_tender_alert' | 'deadline_reminder' | 'bids_opened';

export type OutgoingEmail = { type: EmailType; recipient: string; entityId: string; subject: string; html: string };

export type EmailOutcome = 'sent' | 'suppressed' | 'already_handled' | 'failed';

/** The outside world sendEmail needs, passed in so the rules can be tested without Supabase or Resend. */
export type EmailServices = {
  /** Inserts the email_log row (unique per type, recipient and entity); false if it already exists. */
  claimLogRow: (email: OutgoingEmail, status: 'pending' | 'suppressed') => Promise<boolean>;
  /** Records how a pending email ended. */
  finishLogRow: (email: OutgoingEmail, status: 'sent' | 'failed', providerMessageId: string | null) => Promise<void>;
  /** Hands the email to Resend and returns its message id. */
  deliver: (email: OutgoingEmail) => Promise<string>;
};

/**
 * Reads EMAIL_ALLOWLIST: comma-separated addresses that may receive email, or "*" for everyone (set at
 * go-live). Unset or empty allows nobody, so a function deployed before its setting, or a setting
 * deleted by mistake, can never email a real user.
 */
export function parseAllowlist(setting: string | undefined): (recipient: string) => boolean {
  const entries = (setting ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (entries.includes('*')) {
    return () => true;
  }
  const allowed = new Set(entries);
  // Whole-address match only: no substrings, so "tester@example.com.attacker.net" is not "tester@example.com".
  return (recipient) => allowed.has(recipient.trim().toLowerCase());
}

/** Sends one email unless it was handled before; an address outside the allowlist is logged as suppressed instead. */
export async function sendEmail(email: OutgoingEmail, isAllowed: (recipient: string) => boolean, services: EmailServices): Promise<EmailOutcome> {
  if (!isAllowed(email.recipient)) {
    return (await services.claimLogRow(email, 'suppressed')) ? 'suppressed' : 'already_handled';
  }
  if (!(await services.claimLogRow(email, 'pending'))) {
    return 'already_handled';
  }
  try {
    const providerMessageId = await services.deliver(email);
    await services.finishLogRow(email, 'sent', providerMessageId);
    return 'sent';
  } catch {
    // The row stays claimed, so a retry can't send twice; Stage 2 decides whether failed emails are retried.
    await services.finishLogRow(email, 'failed', null);
    return 'failed';
  }
}
