import { getServerSession } from "next-auth";
import { authOptions } from "@/config/auth.config";

export { authOptions };

/** Requiere rol ADMIN. Lanza si no. */
export async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("No autenticado");
  if (session.user.role !== "ADMIN") {
    throw new Error("Acceso denegado: Se requiere rol ADMIN");
  }
  return { ok: true as const, session };
}

/** Requiere ADMIN o SELLER (vendedor de mostrador). Lanza si no. */
export async function requireAdminOrSeller() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("No autenticado");
  const role = session.user.role;
  if (role !== "ADMIN" && role !== "SELLER") {
    throw new Error("Acceso denegado: Se requiere rol ADMIN o SELLER");
  }
  return { ok: true as const, session, role };
}

/** Cualquier sesión autenticada. Lanza si no. */
export async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("No autenticado");
  return { ok: true as const, session };
}
