Main fixes:
1. supabase-config.js now explicitly creates window.supabaseClient.
2. app.js no longer creates a second Supabase client or uses PROCUREMARKET_CONFIG.
3. auth.js, login.html, registration and protected pages all use the same client.
4. Existing Auth users without a profiles row are repaired on login when account_type exists in user_metadata.
5. Profile forms use the same public.profiles table.

GitHub structure:
HTML files at repository root. Put supabase-config.js, auth.js, app.js and styles.css in /assets.
