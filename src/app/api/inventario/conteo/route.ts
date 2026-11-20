import { NextResponse } from "next/server";
import { requireApiAdmin, requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import {
  countProgress,
  findOpenSession,
  openCount,
  soportaExtras,
  type CountApplyMode,
  type CountStartMode,
} from "@/server/stock-count.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventario/conteo?branchId=… → estado del conteo abierto.
 *
 * Responde `{ session: null }` cuando no hay ninguno en curso, para que la
 * pantalla ofrezca abrirlo en vez de mostrar un error.
 */
export async function GET(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const branchId = new URL(req.url).searchParams.get("branchId");

    const abierta = await findOpenSession(branchId);
    if (!abierta.ok) return NextResponse.json({ error: abierta.error }, { status: 400 });
    const extras = await soportaExtras();
    if (!abierta.sessionId) return NextResponse.json({ session: null, extras });

    const progreso = await countProgress(abierta.sessionId);
    if (!progreso.ok) return NextResponse.json({ error: progreso.error }, { status: 400 });

    return NextResponse.json({ session: progreso.progress, extras });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/inventario/conteo — abre el conteo de la sucursal.
 * Body: { branchId?, applyMode?, startMode?, zeroNow?, openedBy? }
 *
 * `startMode`: `KEEP` mantiene el inventario actual y sólo cambia lo
 * escaneado; `ZERO` parte desde 0 (lo no contado queda en 0 al cerrar).
 *
 * `applyMode` por defecto es `ON_CLOSE`: el conteo no toca el stock hasta
 * cerrarse, así la tienda puede seguir vendiendo mientras se cuenta.
 *
 * `zeroNow` pone en cero todo el stock de la sucursal antes de empezar. Sólo
 * de admin, sólo en modo `LIVE` (la base lo rechaza en `ON_CLOSE`) y NO es lo
 * recomendado: deja el catálogo sin existencias durante todo el conteo.
 */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      branchId?: string | null;
      zeroNow?: boolean;
      applyMode?: string;
      startMode?: string;
      openedBy?: string | null;
    };

    const applyMode: CountApplyMode = body.applyMode === "LIVE" ? "LIVE" : "ON_CLOSE";

    const startMode: CountStartMode = body.startMode === "ZERO" ? "ZERO" : "KEEP";
    const quien =
      typeof body.openedBy === "string" && body.openedBy.trim()
        ? body.openedBy.trim().slice(0, 60)
        : null;

    if (body.zeroNow) {
      const soloAdmin = await requireApiAdmin();
      if (!soloAdmin.ok) {
        return NextResponse.json(
          { error: "Solo un administrador puede poner el inventario en cero" },
          { status: 403 }
        );
      }
    }

    const result = await openCount({
      branchId: body.branchId ?? null,
      openedBy:
        quien ?? auth.session.user?.name ?? auth.session.user?.email ?? auth.userId ?? null,
      startMode,
      zeroNow: Boolean(body.zeroNow),
      applyMode,
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const progreso = await countProgress(result.sessionId);

    return NextResponse.json({
      ok: true,
      yaAbierta: result.yaAbierta,
      applyMode: result.applyMode,
      puestosEnCero: result.puestosEnCero,
      session: progreso.ok ? progreso.progress : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
