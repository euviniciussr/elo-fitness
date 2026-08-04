// Anon/publishable key is safe to expose client-side — access is enforced by RLS policies in Supabase.
const SUPABASE_URL = 'https://ndmnkfgsldumtwxwudrv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_2KJ11EZTws_VY593bVB5bw_-m-N_0lB';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
