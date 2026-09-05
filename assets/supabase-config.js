const SUPABASE_URL =
    'https://ijlcjthgwppllhlqocep.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable_APYr_u3X5T6T9tIrDOTFmQ_Pt9rNtCT';

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);
