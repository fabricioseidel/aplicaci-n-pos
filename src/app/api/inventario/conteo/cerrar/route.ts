import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { closeCount, countProgress } from "@/server/stock-count.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/inventario/conteo/cerrar — cierra el conteo.
 * Body: { sessionId, esperadoPendientes?, zeroUncounted?, deactivateUncounted? }
 *
 * Sólo admin: apagar catálogo es una decisión de negocio, no un paso más del
 * escaneo. `esperadoPendientes` es el número que la pantalla le mostró a quien
 * confirma; si en la base ya es otro (alguien siguió escaneando desde otro
 * teléfono) se aborta con 409 en vez de apagar más productos de los que la
 * persona aceptó.
 */
export async function POST(req: Request) {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      sessionId?: string;
      esperadoPendientes?: number;
      zeroUncounted?: boolean;
      deactivateUncounted?: boolean;
    };

    if (!body.sessionId) {
      return NextResponse.json({ error: "Falta la sesión de conteo" }, { status: 400 });
    }

    const previo = await countProgress(body.sessionId);
    if (!previo.ok) return NextResponse.json({ error: previo.error }, { status: 400 });

    const esperado = Number(body.esperadoPendientes);
    if (Number.isFinite(esperado) && previo.progress.pendientes !== esperado) {
      return NextResponse.json(
        {
          error: "El conteo cambió mientras confirmabas",
          esperado,
          actual: previo.progress.pendientes,
        },
        { status: 409 }
      );
    }

    const result = await closeCount({
      sessionId: body.sessionId,
      closedBy: auth.session.user?.name ?? auth.session.user?.email ?? auth.userId ?? null,
      zeroUncounted: body.zeroUncounted !== false,
      deactivateUncounted: body.deactivateUncounted !== false,
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    return NextResponse.json({
      ok: true,
      contados: result.contados,
      puestosEnCero: result.puestosEnCero,
      desactivados: result.desactivados,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
