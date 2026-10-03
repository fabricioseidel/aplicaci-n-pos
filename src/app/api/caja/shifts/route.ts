import { NextRequest, NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import {
  openShift,
  getCurrentShift,
  getLastClosedShift,
  TurnoYaAbiertoError,
} from "@/server/shifts.service";
import { resolveBranchId, SinSucursalError } from "@/server/branches.service";
import { parseDejaParaManana } from "@/lib/cierre/dejaParaManana";

export const dynamic = "force-dynamic";

/**
 * GET /api/caja/shifts?branchId=xxx — turno abierto de esa sucursal (o null).
 *
 * Sin turno abierto trae además `propuesto`: el efectivo con el que conviene
 * abrir, que es lo que el último cierre de la sucursal dijo que dejaba para
 * el día siguiente ("Deja para mañana") o, si no lo dijo, lo que se contó.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const branchId = await resolveBranchId(new URL(req.url).searchParams.get("branchId"));
    const shift = await getCurrentShift({ branchId });
    if (shift) return NextResponse.json({ shift, branchId });

    const ultimo = await getLastClosedShift(branchId);
    const deja = parseDejaParaManana(ultimo?.notes);
    const propuesto =
      deja ?? (ultimo?.actual_cash != null ? Math.round(Number(ultimo.actual_cash)) : null);
    return NextResponse.json({
      shift: null,
      branchId,
      propuesto,
      propuestoOrigen: deja != null ? "deja" : propuesto != null ? "contado" : null,
    });
  } catch (e) {
    if (e instanceof SinSucursalError) return errorResponse(e, e.status);
    return errorResponse(e);
  }
}

/** POST /api/caja/shifts — abre un turno. Body: { startingCash, notes, branchId }. */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json()) as {
      startingCash?: number;
      notes?: string | null;
      branchId?: string | null;
    };

    const startingCash = Number(body.startingCash);
    if (!Number.isFinite(startingCash) || startingCash < 0) {
      return NextResponse.json({ error: "Efectivo inicial inválido" }, { status: 400 });
    }

    // Nunca un turno sin sucursal: una pestaña con el código viejo, o una que
    // todavía no cargó las sucursales, manda `branchId: null` y antes eso
    // abría un turno huérfano que ninguna pantalla de la sucursal veía.
    const branchId = await resolveBranchId(body.branchId);

    // Cada sucursal tiene su propia caja: dos turnos abiertos a la vez EN LA
    // MISMA sucursal harían que las ventas se repartan entre ambos y ninguno
    // cuadre, pero dos sucursales distintas sí pueden tener cada una el suyo.
    // Si ya hay uno abierto para esta sucursal, se devuelve ese.
    const existing = await getCurrentShift({ branchId });
    if (existing) {
      return NextResponse.json({ ok: true, shift: existing, alreadyOpen: true });
    }

    try {
      const shift = await openShift({
        starting_cash: Math.round(startingCash),
        user_id: auth.userId || null,
        branch_id: branchId,
        notes: body.notes ?? null,
      });
      return NextResponse.json({ ok: true, shift });
    } catch (e) {
      // Dos aperturas en paralelo: la base deja pasar una sola (M1) y la otra
      // recibe el turno que quedó abierto, como si hubiera llegado segunda.
      if (e instanceof TurnoYaAbiertoError) {
        const ganador = await getCurrentShift({ branchId });
        if (ganador) return NextResponse.json({ ok: true, shift: ganador, alreadyOpen: true });
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof SinSucursalError) return errorResponse(e, e.status);
    return errorResponse(e);
  }
}
