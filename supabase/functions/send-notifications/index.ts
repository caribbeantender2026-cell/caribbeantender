/**
 * Sends every due email (PRD P1-13). pg_cron calls this every minute with a shared secret kept in
 * Vault (migration 20261114010000); public.due_emails decides who gets what, and sendEmail sends each one
 * at most once, and only to EMAIL_ALLOWLIST until go-live (OPEN_QUESTIONS.md, decision D3).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { idempotencyKey, parseAllowlist, sendEmail, type EmailOutcome, type EmailServices } from '../_shared/email.ts';
import { composeEmail, secretMatches, type DueEmail } from './notifications.ts';

const batchSize = 50;

Deno.serve(async (request) => {
  const database = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  });
  // An unset or unreadable secret refuses every call.
  const expectedSecret = await database.rpc('notifications_cron_secret');
  if (!secretMatches(request.headers.get('x-cron-secret'), expectedSecret.data ?? undefined)) {
    return new Response('Not allowed.', { status: 401 });
  }
  const due = await database.rpc('due_emails', { batch_size: batchSize });
  if (due.error) {
    return new Response(`Could not read the due emails: ${due.error.message}`, { status: 500 });
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const sender = Deno.env.get('EMAIL_FROM') ?? 'CaribbeanTender <no-reply@caribbeantender.com>';
  const services: EmailServices = {
    claimLogRow: async (email, status) => {
      const claimed = await database
        .from('email_log')
        .upsert({ type: email.type, recipient: email.recipient, entity_id: email.entityId, status }, { onConflict: 'type,recipient,entity_id', ignoreDuplicates: true })
        .select('id');
      if (claimed.error) throw new Error(claimed.error.message);
      return claimed.data.length > 0;
    },
    reclaimLogRow: async (email) => {
      const reclaimed = await database.rpc('reclaim_email', { email_type: email.type, email_recipient: email.recipient, email_entity_id: email.entityId });
      if (reclaimed.error) throw new Error(reclaimed.error.message);
      return reclaimed.data === true;
    },
    finishLogRow: async (email, status, providerMessageId) => {
      const finished = await database
        .from('email_log')
        .update({ status, provider_message_id: providerMessageId, sent_at: status === 'sent' ? new Date().toISOString() : null })
        .match({ type: email.type, recipient: email.recipient, entity_id: email.entityId });
      if (finished.error) throw new Error(finished.error.message);
    },
    deliver: async (email) => {
      if (!resendApiKey) throw new Error('RESEND_API_KEY is not set.');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': await idempotencyKey(email) },
        body: JSON.stringify({ from: sender, to: [email.recipient], subject: email.subject, html: email.html }),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok || !body.id) throw new Error(`Resend refused the email: ${body.message ?? response.status}`);
      return body.id;
    },
  };

  const isAllowed = parseAllowlist(Deno.env.get('EMAIL_ALLOWLIST'));
  const siteUrl = Deno.env.get('SITE_URL') ?? 'https://caribbeantender.com';
  const outcomes: Record<EmailOutcome, number> = { sent: 0, suppressed: 0, already_handled: 0, failed: 0 };
  for (const row of due.data as DueEmail[]) {
    try {
      outcomes[await sendEmail(composeEmail(row, siteUrl), isAllowed, services)] += 1;
    } catch (error) {
      // One database hiccup mustn't stop the rest of the batch; the row is offered again once its retry is due.
      console.error(`Email ${row.type} for ${row.entity_id} hit a database error:`, error);
      outcomes.failed += 1;
    }
  }
  // Counts only: the log holds the addresses.
  return new Response(JSON.stringify(outcomes), { headers: { 'Content-Type': 'application/json' } });
});
