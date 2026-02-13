import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseInitError =
  !supabaseUrl || !supabaseAnonKey
    ? "Variáveis de ambiente ausentes: configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no projeto (Vercel > Settings > Environment Variables)."
    : null;

export const supabase = supabaseInitError
  ? null
  : createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
