import { NextRequest, NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { obtenerVenta, permisoAnular, productosSinStock } from "@/server/anulacion.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/caja/ventas/:id — lo que necesita la hoja de "Anular venta" antes
 * de mostrar el botón: si esta sesión puede anularla y qué productos quedarían
 * con stock inventado (ver `productosSinStock`).
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const id = Number((await context.params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Venta inválida" }, { status: 400 });
    }
    const venta = await obtenerVenta(id);
    if (!venta) return NextResponse.json({ error: "La venta no existe" }, { status: 404 });

    const [permiso, sinStock] = await Promise.all([
      permisoAnular(auth.role, venta),
      venta.voided ? Promise.resolve([]) : productosSinStock(venta.id, venta.branch_id),
    ]);
    return NextResponse.json({ permiso, sinStock, rol: auth.role });
  } catch (e) {
    return errorResponse(e);
  }
}
