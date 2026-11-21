import { supabaseServer } from "@/lib/supabase-server";
import { getDefaultBranch } from "@/server/branches.service";

export interface TransferItem {
  barcode: string;
  qty: number;
}

export interface CreateTransferInput {
  items: TransferItem[];
  /** Sede que entrega. Sin ella (clientes viejos, outbox) es la matriz. */
  fromBranchId?: string | null;
  /** Sede que recibe. */
  toBranchId: string;
  reference?: string | null;
  notes?: string | null;
  /** Clave de idempotencia del cliente: evita que el outbox traspase dos veces. */
  opId?: string | null;
  /** Quién lo hizo, para el historial ("Mariana (POS · caja@…)"). */
  actor?: string | null;
}

interface Sede {
  id: string;
  name: string;
}

async function sedesActivas(ids: string[]): Promise<Map<string, Sede>> {
  const { data, error } = await supabaseServer
    .from("branches")
    .select("id, name, is_active")
    .in("id", ids);
  if (error) throw new Error(error.message);
  const mapa = new Map<string, Sede>();
  for (const b of (data ?? []) as Array<{ id: string; name: string; is_active: boolean | null }>) {
    if (b.is_active !== false) mapa.set(b.id, { id: b.id, name: b.name });
  }
  return mapa;
}

/**
 * Traspasa stock entre dos sedes: resta en `branch_stock` del origen y suma
 * en el destino, vía el RPC `apply_transfer`. No crea ni destruye stock: lo
 * mueve. Funciona en los dos sentidos (minimarket → sucursal y al revés).
 *
 * Si el origen tiene registrado menos de lo que se mueve, queda en 0: lo que
 * se tiene en la mano existe, el número del sistema era el que estaba mal.
 *
 * Cada traspaso queda en `audit_logs` (`inventory.transfer`) con quién, desde
 * dónde, hacia dónde y qué productos: es el historial que muestra el POS.
 */
export async function createTransfer({
  items,
  fromBranchId,
  toBranchId,
  reference,
  notes,
  opId,
  actor,
}: CreateTransferInput): Promise<{ ok: true; transferId: string; count: number } | { ok: false; error: string }> {
  if (!items?.length) return { ok: false, error: "No hay ítems para traspasar" };
  if (!toBranchId) return { ok: false, error: "Falta la sede destino" };

  let origen = fromBranchId ?? null;
  if (!origen) {
    const matriz = await getDefaultBranch();
    if (!matriz) return { ok: false, error: "No hay una sucursal matriz configurada" };
    origen = matriz.id;
  }
  if (origen === toBranchId) return { ok: false, error: "El origen y el destino son la misma sede" };

  const sedes = await sedesActivas([origen, toBranchId]);
  const desde = sedes.get(origen);
  const hacia = sedes.get(toBranchId);
  if (!desde || !hacia) return { ok: false, error: "El origen o el destino no es una sede activa" };

  const payload = items
    .filter((i) => i?.barcode && Number(i.qty) > 0)
    .map((i) => ({ barcode: String(i.barcode), qty: Number(i.qty) }));
  if (payload.length === 0) return { ok: false, error: "Ningún ítem válido" };

  const { data, error } = await supabaseServer.rpc("apply_transfer", {
    p_items: payload,
    p_from_branch_id: desde.id,
    p_to_branch_id: hacia.id,
    p_reference: reference ?? null,
    p_notes: notes ?? null,
    p_op_id: opId ?? null,
  });

  if (error) return { ok: false, error: error.message };

  const transferId = (data as string) ?? "";
  // El RPC devuelve este centinela cuando el op_id ya estaba aplicado: el
  // traspaso entró la primera vez, no se movió nada ahora.
  if (transferId === "YA_APLICADO") {
    return { ok: true, transferId, count: 0 };
  }

  try {
    const { data: nombres } = await supabaseServer
      .from("products")
      .select("barcode, name")
      .in("barcode", payload.map((p) => p.barcode));
    const nombre = new Map(
      ((nombres ?? []) as Array<{ barcode: string; name: string | null }>).map((n) => [n.barcode, n.name])
    );
    const { error: errAudit } = await supabaseServer.from("audit_logs").insert({
      action: "inventory.transfer",
      entity: "transfers",
      entity_id: transferId,
      actor: actor ?? "POS",
      details: {
        desde,
        hacia,
        opId: opId ?? null,
        unidades: payload.reduce((a, p) => a + p.qty, 0),
        items: payload.map((p) => ({ ...p, name: nombre.get(p.barcode) ?? p.barcode })),
      },
    });
    if (errAudit) console.error("[traspaso] audit_logs:", errAudit.message);
  } catch (e) {
    console.error("[traspaso] audit_logs:", e);
  }

  return { ok: true, transferId, count: payload.length };
}

export interface TraspasoHistorial {
  transferId: string;
  fecha: string;
  actor: string | null;
  desde: Sede;
  hacia: Sede;
  unidades: number;
  items: Array<{ barcode: string; name: string; qty: number }>;
}

/** Últimos traspasos en los que participa la sede (o todos, sin sede). */
export async function listTransfers(
  branchId?: string | null,
  limite = 30
): Promise<{ ok: true; traspasos: TraspasoHistorial[] } | { ok: false; error: string }> {
  const { data, error } = await supabaseServer
    .from("audit_logs")
    .select("entity_id, actor, details, created_at")
    .eq("action", "inventory.transfer")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { ok: false, error: error.message };

  const traspasos = ((data ?? []) as Array<{
    entity_id: string;
    actor: string | null;
    created_at: string;
    details: Partial<TraspasoHistorial> | null;
  }>)
    .filter((r) => r.details?.desde && r.details?.hacia)
    .map((r) => ({
      transferId: r.entity_id,
      fecha: r.created_at,
      actor: r.actor,
      desde: r.details!.desde as Sede,
      hacia: r.details!.hacia as Sede,
      unidades: Number(r.details!.unidades ?? 0),
      items: (r.details!.items ?? []) as TraspasoHistorial["items"],
    }))
    .filter((t) => !branchId || t.desde.id === branchId || t.hacia.id === branchId)
    .slice(0, limite);

  return { ok: true, traspasos };
}

/** Stock de una sede por producto (lo que no tiene fila es 0). */
export async function stockDeSede(branchId: string): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabaseServer
      .from("branch_stock")
      .select("product_barcode, stock")
      .eq("branch_id", branchId)
      .range(desde, desde + 999);
    if (error) throw new Error(error.message);
    const filas = (data ?? []) as Array<{ product_barcode: string; stock: number | string | null }>;
    for (const f of filas) mapa.set(f.product_barcode, Number(f.stock ?? 0));
    if (filas.length < 1000) break;
  }
  return mapa;
}
