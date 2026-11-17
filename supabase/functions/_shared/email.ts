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
  /** Takes back an existing row whose retry is due (public.reclaim_email); false if none, or another run got it. */
  reclaimLogRow: (email: OutgoingEmail) => Promise<boolean>;
  /** Records how a pending email ended. */
  finishLogRow: (email: OutgoingEmail, status: 'sent' | 'failed' | 'suppressed', providerMessageId: string | null) => Promise<void>;
  /** Hands the email to Resend, with idempotencyKey(email), and returns its message id. */
  deliver: (email: OutgoingEmail) => Promise<string>;
};

// RFC 2606 and 6761 reserve these names for testing; mail to them only bounces, and bounces hurt the
// sending domain's reputation. The live test suites' accounts use example.com.
const reservedTestDomain = /(^|\.)(example\.(com|net|org)|test|example|invalid|localhost)$/;

/**
 * Reads EMAIL_ALLOWLIST: comma-separated addresses that may receive email, or "*" for everyone (set at
 * go-live). Unset or empty allows nobody, so a function deployed before its setting, or a setting
 * deleted by mistake, can never email a real user. Reserved test domains are never allowed.
 */
export function parseAllowlist(setting: string | undefined): (recipient: string) => boolean {
  const entries = (setting ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  const allowsEveryone = entries.includes('*');
  const allowed = new Set(entries);
  return (recipient) => {
    const address = recipient.trim().toLowerCase();
    if (reservedTestDomain.test(address.split('@').pop() ?? '')) return false;
    // Whole-address match only: no substrings, so "tester@example.com.attacker.net" is not "tester@example.com".
    return allowsEveryone || allowed.has(address);
  };
}

/**
 * The key Resend uses to send an email at most once in 24 hours, even when a retry repeats a send whose
 * answer was lost. Hashed, because Resend allows 256 characters and an address alone may have 320.
 */
export async function idempotencyKey(email: OutgoingEmail): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${email.type}\n${email.entityId}\n${email.recipient.toLowerCase()}`));
  return `email-log/${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Sends one email unless it was handled before; an address outside the allowlist is logged as suppressed
 * instead. A failed email stays in email_log as failed, and public.due_emails offers it again once its
 * retry is due (migration 20261117030000).
 */
export async function sendEmail(email: OutgoingEmail, isAllowed: (recipient: string) => boolean, services: EmailServices): Promise<EmailOutcome> {
  if (!isAllowed(email.recipient)) {
    if (await services.claimLogRow(email, 'suppressed')) return 'suppressed';
    if (!await services.reclaimLogRow(email)) return 'already_handled';
    await services.finishLogRow(email, 'suppressed', null);
    return 'suppressed';
  }
  const isClaimed = (await services.claimLogRow(email, 'pending')) || (await services.reclaimLogRow(email));
  if (!isClaimed) {
    return 'already_handled';
  }
  let providerMessageId: string;
  try {
    providerMessageId = await services.deliver(email);
  } catch {
    await services.finishLogRow(email, 'failed', null);
    return 'failed';
  }
  // Outside the try: Resend has the email, so a database error here must not record it as failed. If
  // this throws, the row stays pending and is retried later, which the idempotency key makes harmless.
  await services.finishLogRow(email, 'sent', providerMessageId);
  return 'sent';
}
