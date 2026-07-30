import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Esta app ES el POS: prácticamente todo requiere sesión, así que el matcher
 * protege la raíz completa y sólo deja fuera lo imprescindible para poder
 * iniciar sesión y para que el service worker/PWA funcione.
 *
 * - navegación sin sesión → redirige a /login?callbackUrl=...
 * - /api/** sin sesión    → 401 JSON (nunca un redirect: rompería los fetch
 *                           del cliente y el drenaje del outbox offline)
 * - rol distinto de ADMIN/SELLER → 403 en API, /login en navegación
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api");

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const role = (token.role || "").toString().toUpperCase();
  if (role !== "ADMIN" && role !== "SELLER") {
    if (isApi) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("error", "SinPermiso");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /**
     * Todo salvo:
     *  - /login              (la propia pantalla de acceso)
     *  - /api/auth/**        (endpoints de NextAuth)
     *  - assets de Next, favicon, manifest, iconos
     *  - sw.js / workers de Serwist (el SW se registra sin sesión; si el
     *    middleware lo redirigiera a /login, el navegador guardaría HTML como
     *    si fuera el service worker y la PWA quedaría rota)
     */
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|sw.js|swe-worker-.*\\.js).*)",
  ],
};
