import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseInitError =
  !supabaseUrl || !supabaseAnonKey
    ? "Variáveis de ambiente ausentes: configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em frontend/.env para desenvolvimento local ou no Vercel para deploy."
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
