import { supabaseServer } from "@/lib/supabase-server";

/**
 * Compras del personal que quedaron sin dueño.
 *
 * Antes del PR #8 la compra propia se anotaba a nombre de la sesión, y las
 * cuentas del POS no están vinculadas a `sellers`: quedaron compras con
 * `seller_id` NULL (o a nombre de una cuenta tipo "ADMIN PRINCIPAL") que la
 * liquidación de OlivoWeb agrupa como "Sin vendedor" y nadie paga. Acá se
 * listan y se le asigna la persona que compró, sin cambiar el esquema.
 */

/** "ADMIN PRINCIPAL" es una cuenta, no una persona (mismo filtro que useStaff). */
const ES_CUENTA = /^admin\b/i;

export interface CompraSinDueno {
  id: number;
  ts: string;
  total: number;
  seller_id: string | null;
  seller_name: string | null;
  notes: string | null;
  sale_items: Array<{ product_name: string | null; quantity: number; subtotal: number }>;
}

export class AsignacionError extends Error {
  constructor(message: string, readonly status: 404 | 409 | 400) {
    super(message);
    this.name = "AsignacionError";
  }
}

async function idsDeCuentas(): Promise<string[]> {
  const { data, error } = await supabaseServer.from("sellers").select("id, name");
  if (error) throw new Error(error.message);
  return (data ?? []).filter((s) => ES_CUENTA.test(String(s.name).trim())).map((s) => s.id as string);
}

/** Filtro PostgREST: sin dueño o a nombre de una cuenta. */
function filtroSinDueno(cuentas: string[]): string {
  return cuentas.length > 0 ? `seller_id.is.null,seller_id.in.(${cuentas.join(",")})` : "seller_id.is.null";
}

export async function listarSinDueno(): Promise<CompraSinDueno[]> {
  const cuentas = await idsDeCuentas();
  const { data, error } = await supabaseServer
    .from("sales")
    .select("id, ts, total, seller_id, seller_name, notes, sale_items(product_name, quantity, subtotal)")
    .eq("is_staff_purchase", true)
    .eq("voided", false)
    .is("staff_settled_at", null)
    .or(filtroSinDueno(cuentas))
    .order("ts", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as CompraSinDueno[];
}

/**
 * Asigna la compra a `sellerId`. Es un update condicional: sólo si sigue sin
 * dueño y sin liquidar, para que dos teléfonos no se pisen y nadie cambie una
 * compra ya pagada. Asignar dos veces la misma persona responde ok.
 */
export async function asignarDueno(
  saleId: number,
  sellerId: string,
  atendia: string
): Promise<{ yaAsignada: boolean; sellerName: string }> {
  const { data: seller, error: e1 } = await supabaseServer
    .from("sellers")
    .select("id, name, active")
    .eq("id", sellerId)
    .maybeSingle();
  if (e1) throw new Error(e1.message);
  if (!seller || seller.active === false || ES_CUENTA.test(String(seller.name).trim())) {
    throw new AsignacionError("Esa persona no está en la lista del personal", 400);
  }

  const { data: venta, error: e2 } = await supabaseServer
    .from("sales")
    .select("id, seller_id, notes, is_staff_purchase, voided, staff_settled_at")
    .eq("id", saleId)
    .maybeSingle();
  if (e2) throw new Error(e2.message);
  if (!venta || !venta.is_staff_purchase) {
    throw new AsignacionError("No es una compra del personal", 404);
  }
  if (venta.seller_id === sellerId) return { yaAsignada: true, sellerName: seller.name as string };

  const fecha = new Date().toLocaleDateString("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
  });
  const linea = `Dueño asignado ${fecha}${atendia ? ` (atendía: ${atendia})` : ""}`;

  // La condición es "sigue con el mismo dueño que vimos" (nulo o una cuenta):
  // si otro teléfono la asignó entre medio, el update no toca ninguna fila.
  // (Un `.or()` en un PATCH falla en PostgREST: "column sales.seller_id does
  // not exist"; por eso se filtra con el valor leído.)
  const cuentas = await idsDeCuentas();
  const sinDueno = venta.seller_id === null || cuentas.includes(venta.seller_id as string);
  let update = supabaseServer
    .from("sales")
    .update({
      seller_id: sellerId,
      seller_name: seller.name,
      notes: venta.notes ? `${venta.notes}\n${linea}` : linea,
    })
    .eq("id", saleId)
    .eq("is_staff_purchase", true)
    .eq("voided", false)
    .is("staff_settled_at", null);
  update = venta.seller_id === null ? update.is("seller_id", null) : update.eq("seller_id", venta.seller_id);
  const { data: actualizadas, error: e3 } = sinDueno
    ? await update.select("id")
    : { data: [], error: null };
  if (e3) throw new Error(e3.message);

  if (!actualizadas || actualizadas.length === 0) {
    throw new AsignacionError(
      venta.staff_settled_at
        ? "Esa compra ya se liquidó: no se puede cambiar"
        : venta.voided
          ? "Esa compra está anulada"
          : "Esa compra ya tiene dueño",
      409
    );
  }
  return { yaAsignada: false, sellerName: seller.name as string };
}
