import { supabaseServer } from "@/lib/supabase-server";
import { getDefaultBranch } from "@/server/branches.service";

export interface TransferItem {
  barcode: string;
  qty: number;
}

export interface CreateTransferInput {
  items: TransferItem[];
  /** Sucursal que recibe. La matriz (origen) siempre se resuelve en el servidor. */
  toBranchId: string;
  reference?: string | null;
  notes?: string | null;
}

/**
 * Traspasa stock de la casa matriz a una sucursal: resta de `branch_stock`
 * de la matriz y suma en la sucursal destino, vía el RPC `apply_transfer`.
 *
 * El origen NUNCA lo manda el cliente — siempre es la sucursal `is_default`
 * — para que no se pueda armar un traspaso entre dos sucursales cualquiera
 * ni falsear el origen desde el front.
 */
export async function createTransfer({
  items,
  toBranchId,
  reference,
  notes,
}: CreateTransferInput): Promise<{ ok: true; transferId: string; count: number } | { ok: false; error: string }> {
  if (!items?.length) return { ok: false, error: "No hay ítems para traspasar" };
  if (!toBranchId) return { ok: false, error: "Falta la sucursal destino" };

  const matriz = await getDefaultBranch();
  if (!matriz) return { ok: false, error: "No hay una sucursal matriz configurada" };
  if (matriz.id === toBranchId) {
    return { ok: false, error: "La matriz no puede traspasarse stock a sí misma" };
  }

  const payload = items
    .filter((i) => i.barcode && i.qty > 0)
    .map((i) => ({ barcode: i.barcode, qty: i.qty }));

  if (payload.length === 0) return { ok: false, error: "Ningún ítem válido" };

  const { data, error } = await supabaseServer.rpc("apply_transfer", {
    p_items: payload,
    p_from_branch_id: matriz.id,
    p_to_branch_id: toBranchId,
    p_reference: reference ?? null,
    p_notes: notes ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, transferId: (data as string) ?? "", count: payload.length };
}
