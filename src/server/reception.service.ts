import { supabaseServer } from "@/lib/supabase-server";
import { codigosConCostoDeProveedor } from "@/server/productos.service";
import { reglaDeMargen } from "@/lib/inventario/precios";
import type { InfoRecepcion } from "@/lib/inventario/recepcion";

export interface ReceptionItem {
  barcode: string;
  qty: number;
  name?: string | null;
}

export interface CreateReceptionInput {
  items: ReceptionItem[];
  branchId?: string | null;
  reference?: string | null;
  notes?: string | null;
  /**
   * UUID generado en el cliente. La base lo registra en `stock_ops` y con eso
   * descarta el reenvío del outbox de una recepción que sí había entrado.
   */
  opId?: string | null;
}

/**
 * Registra una recepción de inventario: incrementa branch_stock y deja un
 * inventory_movements (type='IN') por cada ítem, vía el RPC `apply_reception`.
 *
 * `products.stock` NO se toca acá: es derivado de `branch_stock` y lo recalcula
 * un trigger en la base.
 *
 * Firma verificada contra la base en vivo:
 *   apply_reception(p_items jsonb, p_branch_id uuid, p_reference text,
 *                   p_notes text, p_op_id text)
 */
export async function createReception({
  items,
  branchId,
  reference,
  notes,
  opId,
}: CreateReceptionInput): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (!items?.length) return { ok: false, error: "No hay ítems para recibir" };

  const payload = items
    .filter((i) => i.barcode && i.qty > 0)
    .map((i) => ({ barcode: i.barcode, qty: i.qty, name: i.name ?? null }));

  if (payload.length === 0) return { ok: false, error: "Ningún ítem válido" };

  const { data, error } = await supabaseServer.rpc("apply_reception", {
    p_items: payload,
    p_branch_id: branchId ?? null,
    p_reference: reference ?? null,
    p_notes: notes ?? null,
    p_op_id: opId ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, count: (data as number) ?? payload.length };
}

/**
 * Lo que la pantalla de Recepción necesita de cada producto para mostrar
 * precio y costo y sugerir un precio de venta: el precio y el costo SIN
 * redondear (son el `expected` del PATCH), si el costo lo fija un proveedor
 * (entonces es solo lectura) y la regla de margen que le toca.
 *
 * El costo sólo viaja a un ADMIN, como en el resto del POS.
 */
export async function infoRecepcion(
  barcodes: string[],
  verCosto: boolean
): Promise<InfoRecepcion[]> {
  const codigos = [...new Set(barcodes.filter(Boolean))].slice(0, 200);
  if (codigos.length === 0) return [];

  const [productos, reglas, conProveedor] = await Promise.all([
    supabaseServer
      .from("products")
      .select("barcode, sale_price, purchase_price, category, margin_override")
      .in("barcode", codigos),
    supabaseServer.from("category_margins").select("category, margin, rounding"),
    codigosConCostoDeProveedor(codigos),
  ]);
  if (productos.error) throw productos.error;
  // Sin la tabla de márgenes se sugiere con el 35 % por defecto.
  const filasReglas = reglas.error
    ? []
    : ((reglas.data ?? []) as Array<{ category: string; margin: unknown; rounding?: unknown }>);

  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  return ((productos.data ?? []) as Array<Record<string, unknown>>).map((p) => {
    const barcode = String(p.barcode);
    const costo = num(p.purchase_price);
    return {
      barcode,
      precio: num(p.sale_price),
      // Sin redondear y tal cual (0 incluido): es el `expected` del PATCH.
      costoNeto: verCosto ? costo : null,
      costoDelProveedor: conProveedor.has(barcode),
      regla: reglaDeMargen(
        { category: (p.category as string | null) ?? null, margin_override: p.margin_override },
        filasReglas
      ),
    };
  });
}
