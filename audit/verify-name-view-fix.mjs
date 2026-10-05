// Check 3 for the name-view fix: the same attempts through the real REST API, as a visitor with no login.
// It cannot change data: every write targets a user ID that does not exist.
// Usage (in a folder with @supabase/supabase-js installed):
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... node verify-name-view-fix.mjs
// Expected after the fix: "ok" on every line (select allowed; update, delete and insert refused).
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !publishableKey) throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');

const anonymous = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } });
const nonexistentUserId = '00000000-0000-0000-0000-000000000000';
const permissionDeniedCode = '42501';

for (const viewName of ['supplier_names_public', 'business_names_public']) {
  const attempts = {
    select: await anonymous.from(viewName).select('user_id').limit(0),
    update: await anonymous.from(viewName).update({ company_name: 'verification probe' }).eq('user_id', nonexistentUserId),
    delete: await anonymous.from(viewName).delete().eq('user_id', nonexistentUserId),
    insert: await anonymous.from(viewName).insert({ user_id: nonexistentUserId, company_name: 'verification probe' }),
  };
  for (const [operation, { error }] of Object.entries(attempts)) {
    const outcome = !error ? 'allowed'
      : error.code === permissionDeniedCode ? 'refused'
      : `failed for another reason: ${error.code} ${error.message}`;
    const expectedOutcome = operation === 'select' ? 'allowed' : 'refused';
    console.log(`${outcome === expectedOutcome ? 'ok        ' : 'UNEXPECTED'} | ${viewName} | ${operation} | ${outcome}`);
  }
}
