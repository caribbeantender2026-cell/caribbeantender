// CaribbeanTender Supabase browser client.
// The publishable key is safe to use in browser code when RLS policies are configured correctly.

window.SUPABASE_URL = 'https://ijlcjthgwppllhlqocep.supabase.co';
window.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_APYr_u3X5T6T9tIrDOTFmQ_Pt9rNtCT';

if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  console.error('Supabase JavaScript library did not load.');
} else {
  window.supabaseClient = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
}
