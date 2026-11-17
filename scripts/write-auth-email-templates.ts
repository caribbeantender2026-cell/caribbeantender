/**
 * Writes the Supabase Auth email templates (sign-up confirmation, password reset and the rest) into
 * supabase/templates/, in the same branded frame as the app's own emails, so every email the site sends
 * looks the same. Paste each file into Supabase: Authentication > Emails > Templates (DEPLOY.md).
 *
 * Usage: node scripts/write-auth-email-templates.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { brandedEmail, paragraph } from '../supabase/functions/send-notifications/notifications.ts';

const siteUrl = 'https://caribbeantender.com';
// Supabase fills these Go template fields in when it sends; they must reach the files unchanged.
const confirmationLink = '{{ .ConfirmationURL }}';
const ignoreIfNotYou = "If you didn't ask for this, you can ignore this email.";

const templates = [
  {
    file: 'confirmation.html',
    subject: 'Confirm your CaribbeanTender account',
    heading: 'Confirm your email',
    bodyHtml: paragraph('Thanks for signing up to CaribbeanTender. Confirm this is your email address to finish creating your account.'),
    button: { label: 'Confirm my email', url: confirmationLink },
    footnoteHtml: "If you didn't sign up, you can ignore this email.",
  },
  {
    file: 'recovery.html',
    subject: 'Reset your CaribbeanTender password',
    heading: 'Reset your password',
    bodyHtml: paragraph('Someone asked to reset the password for {{ .Email }}. Choose a new one with the button below. The link works once.'),
    button: { label: 'Choose a new password', url: confirmationLink },
    footnoteHtml: "If you didn't ask for this, ignore this email and your password stays the same.",
  },
  {
    file: 'magic_link.html',
    subject: 'Your CaribbeanTender sign-in link',
    heading: 'Sign in to CaribbeanTender',
    bodyHtml: paragraph('Use the button below to sign in. The link works once.'),
    button: { label: 'Sign in', url: confirmationLink },
    footnoteHtml: ignoreIfNotYou,
  },
  {
    file: 'email_change.html',
    subject: 'Confirm your new email address',
    heading: 'Confirm your new email',
    bodyHtml: paragraph('You asked to change your CaribbeanTender email from {{ .Email }} to {{ .NewEmail }}. Confirm the change with the button below.'),
    button: { label: 'Confirm the change', url: confirmationLink },
    footnoteHtml: "If you didn't ask for this, email support@caribbeantender.com straight away.",
  },
  {
    file: 'invite.html',
    subject: "You're invited to CaribbeanTender",
    heading: "You're invited",
    bodyHtml: paragraph("You've been invited to join CaribbeanTender, the private procurement platform for the Caribbean."),
    button: { label: 'Accept the invitation', url: confirmationLink },
    footnoteHtml: ignoreIfNotYou,
  },
  {
    file: 'reauthentication.html',
    subject: 'Your CaribbeanTender confirmation code',
    heading: 'Your confirmation code',
    bodyHtml:
      paragraph('Enter this code to confirm it is you:') +
      paragraph('<strong style="font-size:28px;letter-spacing:6px;color:#00204F;">{{ .Token }}</strong>'),
    footnoteHtml: "If you didn't ask for this, change your password.",
  },
];

const folder = new URL('../supabase/templates/', import.meta.url);
mkdirSync(folder, { recursive: true });
for (const { file, subject, ...content } of templates) {
  writeFileSync(new URL(file, folder), `${brandedEmail({ siteUrl, preview: subject, ...content })}\n`);
  console.log(`${file}  subject: ${subject}`);
}
