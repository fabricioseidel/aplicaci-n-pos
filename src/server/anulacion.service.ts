import { supabaseServer } from "@/lib/supabase-server";
import { puedeAnular, MARCA_PEDIDO_ANULACION, type PermisoAnular } from "@/lib/caja/anular";
import type { ApiRole } from "@/lib/api-auth";

/**
 * Anulación de ventas desde el POS (Caja → Turno → Ventas del turno).
 *
 * El trabajo lo hace el RPC `anular_venta` (OlivoWeb #110): marca la venta,
 * repone el stock de la sucursal y deja un `SALE_VOID` por línea, todo con la
 * venta bloqueada (`FOR UPDATE`), así que dos anulaciones a la vez reponen una
 * sola vez. `close_shift` y `registrar_cierre` ya excluyen las anuladas.
 */

export interface VentaParaAnular {
  id: number;
  ts: string;
  shift_id: string | null;
  branch_id: string | null;
  voided: boolean;
  notes: string | null;
}

export async function obtenerVenta(id: number): Promise<VentaParaAnular | null> {
  const { data, error } = await supabaseServer
    .from("sales")
    .select("id, ts, shift_id, branch_id, voided, notes")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VentaParaAnular) ?? null;
}

/** Turno abierto de la sucursal de la venta, para la regla de la vendedora. */
async function turnoAbiertoDe(venta: VentaParaAnular): Promise<string | null> {
  if (!venta.shift_id) return null;
  const { data, error } = await supabaseServer
    .from("cash_shifts")
    .select("id, status")
    .eq("id", venta.shift_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.status === "OPEN" ? (data.id as string) : null;
}

export async function permisoAnular(rol: ApiRole, venta: VentaParaAnular): Promise<PermisoAnular> {
  return puedeAnular({ rol, venta, turnoAbiertoId: await turnoAbiertoDe(venta) });
}

/**
 * Productos de la venta que hoy están en 0 o menos en su sucursal.
 *
 * `apply_sale` nunca deja el stock bajo 0 (lo recorta), pero `anular_venta`
 * devuelve la cantidad completa: si el producto estaba sin stock al vender,
 * anular crea stock que no existe. No se puede saber con certeza cuánto había
 * al vender; un producto que hoy está en 0 es el caso típico, así que se avisa
 * para que lo revisen después.
 */
export async function productosSinStock(saleId: number, branchId: string | null): Promise<string[]> {
  const { data: items, error } = await supabaseServer
    .from("sale_items")
    .select("product_barcode, product_name")
    .eq("sale_id", saleId);
  if (error) throw new Error(error.message);
  if (!items || items.length === 0) return [];

  const barcodes = [...new Set(items.map((i) => i.product_barcode as string))];
  const stock = new Map<string, number>();
  if (branchId) {
    const { data, error: e2 } = await supabaseServer
      .from("branch_stock")
      .select("product_barcode, stock")
      .eq("branch_id", branchId)
      .in("product_barcode", barcodes);
    if (e2) throw new Error(e2.message);
    for (const r of data ?? []) stock.set(r.product_barcode as string, Number(r.stock));
  } else {
    const { data, error: e2 } = await supabaseServer
      .from("products")
      .select("barcode, stock")
      .in("barcode", barcodes);
    if (e2) throw new Error(e2.message);
    for (const r of data ?? []) stock.set(r.barcode as string, Number(r.stock));
  }

  const nombres = new Set<string>();
  for (const i of items) {
    if ((stock.get(i.product_barcode as string) ?? 0) <= 0) {
      nombres.add(((i.product_name as string | null) ?? (i.product_barcode as string)).trim());
    }
  }
  return [...nombres];
}

/** true si la anuló esta llamada; false si ya estaba anulada (idempotente). */
export async function anularVenta(id: number, motivo: string, actor: string): Promise<boolean> {
  const { error } = await supabaseServer.rpc("anular_venta", {
    p_sale_id: id,
    p_motivo: motivo,
    p_actor: actor,
  });
  if (!error) return true;
  // Dos toques o dos teléfonos: la segunda llamada encuentra la venta ya
  // anulada. Para la vendedora el resultado es el mismo.
  if (/ya está anulada/i.test(error.message)) return false;
  throw new Error(error.message);
}

/**
 * "Pedir anulación al admin": deja la marca en las notas de la venta para que
 * el admin la vea en la lista y la anule. No cambia nada más.
 */
export async function pedirAnulacion(venta: VentaParaAnular, motivo: string, quien: string) {
  const cuando = new Date().toLocaleString("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const linea = `${MARCA_PEDIDO_ANULACION} ${cuando} por ${quien}: ${motivo}`;
  const notes = venta.notes ? `${venta.notes}\n${linea}` : linea;
  const { error } = await supabaseServer
    .from("sales")
    .update({ notes })
    .eq("id", venta.id)
    .eq("voided", false);
  if (error) throw new Error(error.message);
}
