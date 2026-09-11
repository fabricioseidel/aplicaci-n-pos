import { NextResponse } from "next/server";
import { requireApiAdmin, requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import {
  countProgress,
  findOpenSession,
  openCount,
  type CountApplyMode,
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
    if (!abierta.sessionId) return NextResponse.json({ session: null });

    const progreso = await countProgress(abierta.sessionId);
    if (!progreso.ok) return NextResponse.json({ error: progreso.error }, { status: 400 });

    return NextResponse.json({ session: progreso.progress });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/inventario/conteo — abre el conteo de la sucursal.
 * Body: { branchId?, applyMode?, zeroNow? }
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
    };

    const applyMode: CountApplyMode = body.applyMode === "LIVE" ? "LIVE" : "ON_CLOSE";

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
      openedBy: auth.session.user?.name ?? auth.session.user?.email ?? auth.userId ?? null,
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
