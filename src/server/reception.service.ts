import { supabaseServer } from "@/lib/supabase-server";

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
