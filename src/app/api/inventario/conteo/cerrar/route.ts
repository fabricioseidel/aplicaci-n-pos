import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { closeCount, countProgress } from "@/server/stock-count.service";
import { parametrosCierre, type ModoCierre } from "@/lib/inventario/conteo";

export const dynamic = "force-dynamic";

/**
 * POST /api/inventario/conteo/cerrar — cierra el conteo.
 * Body: { sessionId, modo: "escaneado" | "todo", esperadoPendientes? }
 *
 * - `escaneado` (conteo de góndola): aplica solo lo contado; lo que no se
 *   escaneó queda como estaba. Lo puede cerrar quien atiende.
 * - `todo` (conteo total de la tienda): además pone en 0 y saca del catálogo
 *   todo lo activo que no se escaneó. Sólo ADMIN y con `esperadoPendientes`
 *   obligatorio: es el número que la persona escribió para confirmar; si en la
 *   base ya es otro (alguien siguió escaneando desde otro teléfono) se aborta
 *   con 409 en vez de apagar más productos de los que aceptó.
 *
 * Compatibilidad: sin `modo`, se lee el formato anterior
 * (`zeroUncounted`/`deactivateUncounted`, por defecto en 0 = `todo`).
 */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      sessionId?: string;
      modo?: string;
      esperadoPendientes?: number;
      zeroUncounted?: boolean;
      deactivateUncounted?: boolean;
    };

    if (!body.sessionId) {
      return NextResponse.json({ error: "Falta la sesión de conteo" }, { status: 400 });
    }

    let modo: ModoCierre;
    if (body.modo === "escaneado" || body.modo === "todo") modo = body.modo;
    else if (body.modo === undefined)
      modo = body.zeroUncounted === false && body.deactivateUncounted === false ? "escaneado" : "todo";
    else return NextResponse.json({ error: "Modo de cierre desconocido" }, { status: 400 });

    const esperado = Number(body.esperadoPendientes);
    if (modo === "todo") {
      if (auth.role !== "ADMIN") {
        return NextResponse.json(
          { error: "Solo un administrador puede poner en 0 lo no contado" },
          { status: 403 }
        );
      }
      if (body.esperadoPendientes === undefined || !Number.isFinite(esperado)) {
        return NextResponse.json(
          { error: "Falta confirmar cuántos productos quedan en 0" },
          { status: 400 }
        );
      }
    }

    const previo = await countProgress(body.sessionId);
    if (!previo.ok) return NextResponse.json({ error: previo.error }, { status: 400 });

    if (modo === "todo" && previo.progress.pendientes !== esperado) {
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
      ...parametrosCierre(modo),
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    return NextResponse.json({
      ok: true,
      modo,
      applyMode: result.applyMode,
      contados: result.contados,
      aplicados: result.aplicados,
      corregidos: result.corregidos,
      enNegativo: result.enNegativo,
      puestosEnCero: result.puestosEnCero,
      desactivados: result.desactivados,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
