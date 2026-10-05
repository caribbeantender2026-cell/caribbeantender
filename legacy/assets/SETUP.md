# Supabase setup

1. Create a Supabase project and open its SQL Editor.
2. Run `supabase/migrations/001_initial_schema.sql` once. It creates all tables, indexes, signup trigger, row-level security policies, and the two private document buckets.
3. In Authentication > URL Configuration, set the Site URL to the deployed site and add your local/deployed URLs as redirect URLs.
4. Copy the Project URL and **anon/public** key from Project Settings > API into `supabase-config.js`. Never use the service-role key in this site.
5. Serve the folder through a web server (for example, VS Code Live Server). The JavaScript module will not reliably load when HTML files are opened directly from disk.

Email confirmation is supported. For quick local testing, you can temporarily disable “Confirm email” in Authentication > Providers > Email.

Documents are private, limited to 10 MB, and restricted to PDF/DOC/DOCX. Tender files are readable by signed-in users. Bid files are readable only by the submitting supplier and the business that owns the tender.
