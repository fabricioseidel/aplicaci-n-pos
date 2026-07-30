import { createClient } from "@supabase/supabase-js";

// Los fallbacks placeholder existen para que `next build` no reviente sin
// secretos reales (mismo patrón que OlivoWeb). En runtime siempre se inyectan
// las variables de verdad.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-during-build.supabase.co";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key-during-build";

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
