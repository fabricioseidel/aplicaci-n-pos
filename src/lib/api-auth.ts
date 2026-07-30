import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/config/auth.config";

export type ApiRole = "ADMIN" | "SELLER" | "USER";

export type ApiAuthResult =
  | { ok: true; session: Session; userId: string; role: ApiRole }
  | { ok: false; response: NextResponse };

const unauth = (status: 401 | 403, msg: string) =>
  NextResponse.json({ error: msg }, { status });

function normalizeRole(session: Session): ApiRole {
  const raw = (session.user?.role || "USER").toString().toUpperCase();
  return raw === "ADMIN" || raw === "SELLER" ? raw : "USER";
}

/**
 * Guardas de autorización para las rutas /api/**.
 *
 * Devuelven una NextResponse en vez de lanzar, para que cada handler pueda
 * cortar temprano con `if (!auth.ok) return auth.response;` sin ensuciar el
 * try/catch propio con 500 falsos.
 */
export async function requireApiAdmin(): Promise<ApiAuthResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false, response: unauth(401, "Unauthorized") };
  const role = normalizeRole(session);
  if (role !== "ADMIN") return { ok: false, response: unauth(403, "Forbidden — admin only") };
  return { ok: true, session, userId: session.user.id ?? "", role };
}

/** Permite ADMIN o SELLER (vendedor de mostrador). */
export async function requireApiAdminOrSeller(): Promise<ApiAuthResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false, response: unauth(401, "Unauthorized") };
  const role = normalizeRole(session);
  if (role !== "ADMIN" && role !== "SELLER") {
    return { ok: false, response: unauth(403, "Forbidden — staff only") };
  }
  return { ok: true, session, userId: session.user.id ?? "", role };
}

/** Cualquier sesión autenticada. */
export async function requireApiAuth(): Promise<ApiAuthResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false, response: unauth(401, "Unauthorized") };
  return { ok: true, session, userId: session.user.id ?? "", role: normalizeRole(session) };
}
