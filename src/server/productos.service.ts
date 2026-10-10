import { supabaseServer } from "@/lib/supabase-server";
import type { ApiRole } from "@/lib/api-auth";
import type { Session } from "next-auth";
import { PRODUCT_COLUMNS } from "@/services/products";

/**
 * Apoyo de servidor para la edición de productos desde el mostrador.
 */

// ── Columnas nuevas que pueden no estar todavía en la base ───────────────

/**
 * Columnas de `products` que agregó una migración reciente. Si el código se
 * despliega antes que la migración, PostgREST rechaza el SELECT entero (42703)
 * y se caería la venta. Se reintenta sin ellas y se recuerda por 5 minutos.
 */
const COLUMNAS_NUEVAS = ["offer_ends_at"] as const;
let sinColumnasNuevasHasta = 0;

type ErrorPg = { code?: string; message?: string } | null;

function faltaColumnaNueva(error: ErrorPg): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "");
  return (
    (error.code === "42703" || error.code === "PGRST204" || /does not exist|Could not find/i.test(msg)) &&
    COLUMNAS_NUEVAS.some((c) => msg.includes(c))
  );
}

export function sinColumnasNuevas(cols: string): string {
  return cols
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && !(COLUMNAS_NUEVAS as readonly string[]).includes(c))
    .join(", ");
}

/**
 * Corre una consulta a `products` con `cols` (por defecto PRODUCT_COLUMNS) y,
 * si la base todavía no tiene una columna nueva, la repite sin ella. Sin
 * `offer_ends_at` toda oferta se trata como "sin fecha de término", que es
 * exactamente lo que había antes.
 */
export async function conColumnasDeProducto<R extends { error: ErrorPg }>(
  consulta: (cols: string) => PromiseLike<R>,
  cols: string = PRODUCT_COLUMNS
): Promise<R> {
  if (Date.now() >= sinColumnasNuevasHasta) {
    const r = await consulta(cols);
    if (!faltaColumnaNueva(r.error)) return r;
    console.warn("[productos] la base no tiene", COLUMNAS_NUEVAS.join(", "), "(falta la migración): sigo sin ellas");
    sinColumnasNuevasHasta = Date.now() + 5 * 60_000;
  }
  return consulta(sinColumnasNuevas(cols));
}

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
