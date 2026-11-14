/**
 * What the platform's emails say (PRD P1-13), and the check that only pg_cron may start a send. Pure
 * functions, so they are tested in Node (tests/functions/notifications.test.ts) as well as run in Deno.
 */
import type { EmailType, OutgoingEmail } from '../_shared/email.ts';

/** One row of public.due_emails. */
export type DueEmail = { type: EmailType; recipient: string; entity_id: string; details: Record<string, unknown> };

const jamaicaTime = new Intl.DateTimeFormat('en-JM', {
  timeZone: 'America/Jamaica',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

/** Tender titles are typed by users, so everything placed in the HTML is escaped. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function text(details: Record<string, unknown>, key: string): string {
  const value = details[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function when(details: Record<string, unknown>, key: string): string {
  const moment = new Date(text(details, key));
  return Number.isNaN(moment.getTime()) ? '' : `${jamaicaTime.format(moment)} Jamaica time`;
}

/** Builds the subject and body of a due email. Links point at the site, never at user-supplied addresses. */
export function composeEmail(due: DueEmail, siteUrl: string): OutgoingEmail {
  const title = text(due.details, 'tender_title');
  // Subjects are plain text, but a title can't add lines to them.
  const subjectTitle = title.replace(/[\r\n]+/g, ' ').slice(0, 120);
  const link = `${siteUrl.replace(/\/+$/, '')}/tenders/${encodeURIComponent(text(due.details, 'tender_id'))}`;
  const safeTitle = escapeHtml(title);
  const content: Record<EmailType, { subject: string; body: string }> = {
    bid_receipt: {
      subject: `Bid received: ${subjectTitle}`,
      body: `<p>Your sealed bid for <strong>${safeTitle}</strong> was received at <strong>${escapeHtml(when(due.details, 'submitted_at'))}</strong>.</p>
<p>Amount: ${escapeHtml(text(due.details, 'amount'))} ${escapeHtml(text(due.details, 'currency'))}. Bids can't be changed after submission.</p>`,
    },
    new_tender_alert: {
      subject: `New tender: ${subjectTitle}`,
      body: `<p>A new tender in your category was published: <strong>${safeTitle}</strong>.</p>
<p>It closes ${escapeHtml(when(due.details, 'closes_at'))}.</p>`,
    },
    deadline_reminder: {
      subject: `Closing in 24 hours: ${subjectTitle}`,
      body: `<p><strong>${safeTitle}</strong> closes ${escapeHtml(when(due.details, 'closes_at'))}, and you haven't bid yet.</p>`,
    },
    bids_opened: {
      subject: `Bids are open: ${subjectTitle}`,
      body: `<p>Your tender <strong>${safeTitle}</strong> has closed. You can now read every bid.</p>`,
    },
  };
  const footer = `<p><a href="${escapeHtml(link)}">Open the tender on CaribbeanTender</a></p>
<p style="color:#6b7280;font-size:12px">You can turn off new tender emails in your supplier profile.</p>`;
  return {
    type: due.type,
    recipient: due.recipient,
    entityId: due.entity_id,
    subject: content[due.type].subject,
    html: `${content[due.type].body}\n${footer}`,
  };
}

/**
 * Whether the request carries the shared secret that only the pg_cron job knows. An unset secret
 * matches nothing. Compares every character, so the time taken doesn't reveal how much matched.
 */
export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected || given === null || given.length !== expected.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}
