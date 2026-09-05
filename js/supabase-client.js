// Anon/publishable key is safe to expose client-side — access is enforced by RLS policies in Supabase.
const SUPABASE_URL = 'https://wqscmenuuipuehiwpiul.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_BfGLiZeKKSw9eE4LnUt1vQ_8MLd9yxw';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
