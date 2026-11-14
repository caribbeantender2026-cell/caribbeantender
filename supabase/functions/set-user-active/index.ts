/**
 * Deactivates or reactivates a user for an admin (PRD P1-15; OPEN_QUESTIONS.md, item 21). The database
 * call runs as the admin, so admin_set_user_active checks the staff role and MFA and writes the audit
 * log; only then does the service role ban or unban the account in Supabase Auth, which ends sign-ins.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Supabase Auth bans for a duration; 100 years stands for "until reactivated".
const banUntilReactivated = '876000h';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return reply(405, { error: 'Send a POST request with user_id and is_active.' });
  }
  const body: unknown = await request.json().catch(() => null);
  const userId = body && typeof body === 'object' && 'user_id' in body ? String(body.user_id) : '';
  const isActive = body && typeof body === 'object' && 'is_active' in body ? body.is_active : null;
  if (!uuidPattern.test(userId) || typeof isActive !== 'boolean') {
    return reply(400, { error: 'user_id must be a user id and is_active must be true or false.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const asAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const changed = await asAdmin.rpc('admin_set_user_active', { user_id: userId, is_active: isActive });
  if (changed.error) {
    return reply(403, { error: changed.error.message });
  }

  const asService = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
  const banned = await asService.auth.admin.updateUserById(userId, { ban_duration: isActive ? 'none' : banUntilReactivated });
  if (banned.error) {
    // The database change stands (and blocks every write); repeating the action is safe.
    return reply(500, { error: `The account was ${isActive ? 'reactivated' : 'deactivated'}, but signing in could not be ${isActive ? 'allowed' : 'blocked'}: ${banned.error.message}. Try again.` });
  }
  return reply(200, { result: isActive ? 'reactivated' : 'deactivated' });
});
