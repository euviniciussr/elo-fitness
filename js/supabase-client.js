// Anon/publishable key is safe to expose client-side — access is enforced by RLS policies in Supabase.
const SUPABASE_URL = 'https://bzjaawrzslnxwkdvwmkj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jEhHhCbSyDF44mqsCOLeOw_Bw7N-Xir';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
