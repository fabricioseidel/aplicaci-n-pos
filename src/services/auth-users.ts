import { supabaseServer } from "@/lib/supabase-server";

export type DbUser = {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  role: string | null;
};

/**
 * Lee un usuario de la tabla `users` (login/credenciales) usando la
 * service_role key para saltarse RLS. `password_hash` es un bcrypt.
 */
export async function getUserByEmail(email: string): Promise<DbUser | null> {
  const { data, error } = await supabaseServer
    .from("users")
    .select("id, email, password_hash, name, role")
    .eq("email", email)
    .maybeSingle();

  if (error || !data) return null;
  return data as DbUser;
}
