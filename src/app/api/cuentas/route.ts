import { NextRequest, NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { listarCuentas, movimientosDeCuenta } from "@/server/cierre.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/cuentas?todas=1  — cuentas de fiado con su saldo.
 * GET /api/cuentas?id=xxx   — movimientos de una cuenta.
 *
 * Por defecto sólo devuelve las que deben algo, que es lo que se necesita al
 * cerrar. El historial completo se pide con `todas=1`.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const params = new URL(req.url).searchParams;

    const id = params.get("id");
    if (id) {
      return NextResponse.json({ movimientos: await movimientosDeCuenta(id) });
    }

    const todas = params.get("todas") === "1";
    const cuentas = await listarCuentas({ soloConDeuda: !todas });
    return NextResponse.json({ cuentas });
  } catch (e) {
    return errorResponse(e);
  }
}
