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

/**
 * An amount as the app's receipt shows it ("$1,500.50"), with the currency code, since "$" alone is
 * ambiguous. Every bid is in JMD (the bids_currency_is_jmd check).
 */
function amount(details: Record<string, unknown>): string {
  const value = Number(details.amount);
  return Number.isFinite(value) ? `${new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD' }).format(value)} (JMD)` : '';
}

function when(details: Record<string, unknown>, key: string): string {
  const moment = new Date(text(details, key));
  return Number.isNaN(moment.getTime()) ? '' : `${jamaicaTime.format(moment)} Jamaica time`;
}

// The client's brand colours (navy #00204F, gold #D99E04), with the site's paper and text greys.
const brandColours = { navy: '#00204F', gold: '#D99E04', paper: '#F4F6F9', text: '#1F2937', quiet: '#6B7280', rule: '#E5E7EB' };
const supportAddress = 'info@caribbeantender.com';
const bodyFont = 'Arial,Helvetica,sans-serif';

/** One paragraph of an email body, spaced the same in every mail client. */
export function paragraph(html: string): string {
  return `<p style="margin:0 0 12px;">${html}</p>`;
}

/** What goes inside the branded frame. Body and footnote are HTML the caller has already escaped. */
export type BrandedEmailContent = {
  siteUrl: string;
  /** The line inboxes show next to the subject. */
  preview: string;
  heading: string;
  bodyHtml: string;
  button?: { label: string; url: string } | undefined;
  footnoteHtml?: string | undefined;
};

/**
 * The CaribbeanTender email frame: a navy band with the logo, a gold rule, the heading and message, one
 * gold button, and the footer. Tables and inline styles only, because mail clients drop style sheets and
 * most layout CSS. Also writes the Supabase Auth templates (scripts/write-auth-email-templates.ts).
 */
export function brandedEmail({ siteUrl, preview, heading, bodyHtml, button, footnoteHtml }: BrandedEmailContent): string {
  const site = siteUrl.replace(/\/+$/, '');
  const buttonHtml = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;"><tr><td style="border-radius:10px;background:${brandColours.gold};padding:12px 22px;"><a href="${escapeHtml(button.url)}" style="display:inline-block;font-family:${bodyFont};font-size:15px;font-weight:bold;color:${brandColours.navy};text-decoration:none;">${escapeHtml(button.label)}</a></td></tr></table>`
    : '';
  const footnote = footnoteHtml ? `<p style="margin:0 0 8px;">${footnoteHtml}</p>` : '';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${brandColours.paper};">
<div style="display:none;mso-hide:all;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${brandColours.paper};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;">
<tr><td style="background:${brandColours.navy};padding:22px 32px;"><a href="${escapeHtml(site)}"><img src="${escapeHtml(site)}/email/logo.png" width="132" alt="CaribbeanTender" style="display:block;border:0;height:auto;"></a></td></tr>
<tr><td style="height:4px;background:${brandColours.gold};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:32px;font-family:${bodyFont};font-size:15px;line-height:1.6;color:${brandColours.text};">
<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;font-weight:normal;color:${brandColours.navy};">${escapeHtml(heading)}</h1>
${bodyHtml}
${buttonHtml}
</td></tr>
<tr><td style="padding:20px 32px 28px;border-top:1px solid ${brandColours.rule};font-family:${bodyFont};font-size:12px;line-height:1.6;color:${brandColours.quiet};">
${footnote}<p style="margin:0;">CaribbeanTender · Private procurement for the Caribbean<br><a href="${escapeHtml(site)}" style="color:${brandColours.quiet};">caribbeantender.com</a> · <a href="mailto:${supportAddress}" style="color:${brandColours.quiet};">${supportAddress}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const alertFootnote = 'You get this because new tender emails are on in your supplier profile. You can turn them off there.';

/** Builds the subject and body of a due email. Links point at the site, never at user-supplied addresses. */
export function composeEmail(due: DueEmail, siteUrl: string): OutgoingEmail {
  const title = text(due.details, 'tender_title');
  // Subjects are plain text, but a title can't add lines to them.
  const subjectTitle = title.replace(/[\r\n]+/g, ' ').slice(0, 120);
  const link = `${siteUrl.replace(/\/+$/, '')}/tenders/${encodeURIComponent(text(due.details, 'tender_id'))}`;
  const safeTitle = escapeHtml(title);
  // due_emails sends bid_count with bids_opened (migration 20261117030000); null if it is missing.
  const bidCount = typeof due.details.bid_count === 'number' ? due.details.bid_count : null;
  const content: Record<EmailType, { subject: string; heading: string; body: string; buttonLabel: string; footnote?: string }> = {
    bid_receipt: {
      subject: `Bid received: ${subjectTitle}`,
      heading: 'Your bid was received',
      body:
        paragraph(`Your sealed bid for <strong>${safeTitle}</strong> was received at <strong>${escapeHtml(when(due.details, 'submitted_at'))}</strong>.`) +
        paragraph(`Amount: ${escapeHtml(amount(due.details))}. Bids can't be changed after submission.`),
      buttonLabel: 'Open the tender',
      footnote: 'Keep this email as your receipt.',
    },
    new_tender_alert: {
      subject: `New tender: ${subjectTitle}`,
      heading: 'A new tender in your category',
      body: paragraph(`A new tender in your category was published: <strong>${safeTitle}</strong>.`) + paragraph(`It closes ${escapeHtml(when(due.details, 'closes_at'))}.`),
      buttonLabel: 'Read the tender',
      footnote: alertFootnote,
    },
    deadline_reminder: {
      subject: `Closing in 24 hours: ${subjectTitle}`,
      heading: 'Closing in 24 hours',
      body: paragraph(`<strong>${safeTitle}</strong> closes ${escapeHtml(when(due.details, 'closes_at'))}, and you haven't bid yet.`),
      buttonLabel: 'Open the tender',
      footnote: alertFootnote,
    },
    bids_opened:
      bidCount === 0
        ? {
            subject: `Tender closed: ${subjectTitle}`,
            heading: 'Your tender has closed',
            body: paragraph(`Your tender <strong>${safeTitle}</strong> has closed. No bids were submitted before the closing time.`),
            buttonLabel: 'Open the tender',
          }
        : {
            subject: `Bids are open: ${subjectTitle}`,
            heading: 'Your bids are open',
            body: paragraph(`Your tender <strong>${safeTitle}</strong> has closed${bidCount === null ? '' : `, and ${bidCount} ${bidCount === 1 ? 'bid' : 'bids'} came in`}. You can now read every bid.`),
            buttonLabel: 'Open the tender',
          },
  };
  const chosen = content[due.type];
  return {
    type: due.type,
    recipient: due.recipient,
    entityId: due.entity_id,
    subject: chosen.subject,
    html: brandedEmail({ siteUrl, preview: chosen.subject, heading: chosen.heading, bodyHtml: chosen.body, button: { label: chosen.buttonLabel, url: link }, footnoteHtml: chosen.footnote }),
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
