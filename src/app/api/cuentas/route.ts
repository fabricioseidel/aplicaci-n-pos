import { NextRequest, NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { listarCuentas } from "@/server/cierre.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/cuentas?todas=1 — cuentas de fiado con su saldo.
 * Por defecto sólo las que deben algo, que es lo que se necesita al cerrar.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const todas = new URL(req.url).searchParams.get("todas") === "1";
    const cuentas = await listarCuentas({ soloConDeuda: !todas });
    return NextResponse.json({ cuentas });
  } catch (e) {
    return errorResponse(e);
  }
}
