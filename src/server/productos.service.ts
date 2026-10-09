import { supabaseServer } from "@/lib/supabase-server";
import type { ApiRole } from "@/lib/api-auth";
import type { Session } from "next-auth";

/**
 * Apoyo de servidor para la edición de productos desde el mostrador.
 */

/** Columnas que sólo ve un ADMIN (misma política que OlivoWeb #110). */
const SOLO_ADMIN = ["purchase_price", "suggested_price"] as const;

/** Quita costos y márgenes de una fila si quien pregunta no es ADMIN. */
export function filaParaRol<T extends Record<string, unknown>>(fila: T, role: ApiRole): T {
  if (role === "ADMIN") return fila;
  const copia: Record<string, unknown> = { ...fila };
  for (const k of SOLO_ADMIN) delete copia[k];
  return copia as T;
}

/**
 * Códigos cuyo costo lo fija un proveedor (`product_suppliers.unit_cost`).
 * En esos productos `purchase_price` es derivado: lo que escriba el POS lo
 * reemplaza un trigger con el costo del proveedor preferido, así que la ficha
 * lo muestra sólo para mirar.
 */
export async function codigosConCostoDeProveedor(barcodes?: string[]): Promise<Set<string>> {
  let q = supabaseServer.from("product_suppliers").select("product_id").not("unit_cost", "is", null);
  if (barcodes) {
    if (barcodes.length === 0) return new Set();
    q = q.in("product_id", barcodes);
  }
  const { data, error } = await q.limit(20000);
  if (error) {
    // Sin la tabla (o sin permiso) se trata como "sin proveedor": el peor caso
    // es que la ficha deje editar un costo que el trigger después reemplaza,
    // y eso se avisa al comparar lo guardado con lo pedido.
    console.error("[productos] product_suppliers:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => String((r as { product_id: string }).product_id)));
}

/**
 * Nombre que queda como responsable de un cambio: quien atiende el mostrador
 * (si el teléfono lo informó) y la cuenta con la que se entró. La cuenta sola
 * no sirve: el teléfono lo usan varias personas con la sesión de una.
 */
export function actorDe(session: Session, atiende?: unknown): string {
  const cuenta = session.user?.email ?? session.user?.name ?? "POS";
  const persona = typeof atiende === "string" ? atiende.trim().slice(0, 80) : "";
  return persona ? `${persona} (POS · ${cuenta})` : `POS · ${cuenta}`;
}

export interface CambioDePrecio {
  barcode: string;
  nombre?: string | null;
  campo: "sale_price" | "offer_price";
  antes: number | null;
  despues: number | null;
}

/**
 * Deja registro de los cambios de precio en `audit_logs`, con el mismo formato
 * que usa OlivoWeb (`products.save` / `details.cambiosDePrecio`), para que el
 * dueño vea en un solo lugar quién cambió qué precio y cuándo. Nunca lanza: si
 * la auditoría falla, el precio ya quedó guardado y eso no se deshace.
 */
export async function registrarCambiosDePrecio(actor: string, cambios: CambioDePrecio[]) {
  if (cambios.length === 0) return;
  try {
    const { error } = await supabaseServer.from("audit_logs").insert({
      action: "products.save",
      entity: "products",
      entity_id: cambios.length === 1 ? cambios[0].barcode : null,
      actor,
      details: { origen: "pos", cambiosDePrecio: cambios },
    });
    if (error) console.error("[productos] audit_logs:", error.message);
  } catch (e) {
    console.error("[productos] audit_logs:", e);
  }
}

/** Registro de un ajuste de stock con su motivo (la base sólo guarda MANUAL_ADJUSTMENT). */
export async function registrarAjusteDeStock(
  actor: string,
  detalle: { barcode: string; nombre?: string | null; antes: number; despues: number; motivo: string; opId: string; branchId: string }
) {
  try {
    const { error } = await supabaseServer.from("audit_logs").insert({
      action: "stock.ajuste",
      entity: "products",
      entity_id: detalle.barcode,
      actor,
      details: { origen: "pos", ...detalle },
    });
    if (error) console.error("[productos] audit_logs:", error.message);
  } catch (e) {
    console.error("[productos] audit_logs:", e);
  }
}

/** Sucursal pedida si existe y está activa; si no, la sucursal por defecto. */
export async function sucursalOPorDefecto(branchId?: unknown): Promise<string | null> {
  if (typeof branchId === "string" && branchId) {
    const { data } = await supabaseServer
      .from("branches")
      .select("id")
      .eq("id", branchId)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }
  const { data } = await supabaseServer.from("branches").select("id").eq("is_default", true).maybeSingle();
  return data?.id ? String(data.id) : null;
}

/** Stock del producto en una sucursal (0 si no tiene fila). */
export async function stockEnSucursal(barcode: string, branchId: string): Promise<number> {
  const { data, error } = await supabaseServer
    .from("branch_stock")
    .select("stock")
    .eq("branch_id", branchId)
    .eq("product_barcode", barcode)
    .maybeSingle();
  if (error) throw error;
  return Number((data as { stock?: number } | null)?.stock ?? 0);
}
