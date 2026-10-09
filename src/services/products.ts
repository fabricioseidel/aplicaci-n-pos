import type { SupaProduct, ProductUI } from "@/types";
import { ofertaVigente } from "@/lib/pos/precios";

export const DEFAULT_IMAGE = "/file.svg";

/** Columnas que el POS necesita de `products`. */
export const PRODUCT_COLUMNS =
  "barcode, name, category, sale_price, offer_price, purchase_price, image_url, stock, featured, is_active, by_weight, measurement_unit, measurement_value, suggested_price, min_stock, optimum_stock, description, updated_at, offer_ends_at";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export function mapSupaToUI(p: SupaProduct): ProductUI {
  const name = p.name ?? "(Sin nombre)";
  const category = p.category ?? "";
  const categories = category
    ? category.split(/[,/|]/).map((c) => c.trim()).filter(Boolean)
    : [];

  const rawSalePrice = Number(p.sale_price ?? 0);
  // Una oferta vencida no viaja: para el catálogo es como si no existiera.
  // La fecha sí viaja, porque el catálogo cacheado puede durar más que la
  // oferta y `unitPriceOf` la vuelve a mirar al cobrar.
  const rawOfferPrice =
    p.offer_price && ofertaVigente(Number(p.offer_price), p.offer_ends_at) ? Number(p.offer_price) : undefined;

  return {
    id: String(p.barcode),
    barcode: p.barcode,
    name,
    // Para productos por peso este precio es POR KILO.
    price: Math.round(rawSalePrice),
    offerPrice: rawOfferPrice ? Math.round(rawOfferPrice) : undefined,
    // null (no undefined) para que sobreviva al JSON y pise una fecha vieja
    // guardada en el carrito.
    offerEndsAt: rawOfferPrice && p.offer_ends_at ? p.offer_ends_at : null,
    image: p.image_url || DEFAULT_IMAGE,
    slug: slugify(name),
    description: p.description || "",
    categories,
    // El stock de un producto por peso es decimal (kg): no se redondea.
    stock: Number(p.stock ?? 0),
    featured: !!p.featured,
    byWeight: !!p.by_weight,
    measurementUnit: p.measurement_unit ?? undefined,
    measurementValue: p.measurement_value ?? undefined,
    suggestedPrice: p.suggested_price ?? undefined,
    // Back-compat: is_active null en registros antiguos se considera activo.
    isActive: p.is_active ?? true,
    purchasePrice: p.purchase_price ? Number(p.purchase_price) : undefined,
    minStock: p.min_stock ?? undefined,
    optimumStock: p.optimum_stock ?? undefined,
    updatedAt: p.updated_at,
  };
}

/**
 * Payload de guardado: sólo los campos que el llamador definió. Un campo que
 * no se manda no se toca en la base — antes se rellenaban con 0/null y cada
 * edición borraba el costo y los mínimos del producto.
 *
 * Sólo columnas que existen de verdad en `products`: mandar `tax_rate`, como
 * hacía OlivoWeb, provoca un PGRST204.
 */
export function buildProductPayload(p: Partial<SupaProduct> & { barcode: string }) {
  const campos = [
    "name", "category", "purchase_price", "sale_price", "stock", "image_url",
    "description", "by_weight", "measurement_unit", "measurement_value",
    "offer_price", "is_active", "min_stock", "optimum_stock",
  ] as const;
  const payload: Record<string, unknown> = { barcode: p.barcode };
  for (const k of campos) {
    if (p[k] !== undefined) payload[k] = p[k];
  }
  payload.updated_at = new Date().toISOString();
  return payload;
}

export interface SaveProductOptions {
  /** Alta: si el código ya existe el servidor responde 409 en vez de pisarlo. */
  crear?: boolean;
  /** Stock que se vio al abrir la ficha; sin él, el stock de un existente no se toca. */
  stockAnterior?: number;
}

/** El código ya pertenece a otro producto (posiblemente desactivado). */
export class ProductExistsError extends Error {
  constructor(
    message: string,
    readonly existente: { barcode: string; name: string | null; isActive: boolean }
  ) {
    super(message);
    this.name = "ProductExistsError";
  }
}

/**
 * Guarda (crea o actualiza) un producto por `barcode`. Devuelve `stockError`
 * cuando el producto se guardó pero el cambio de stock no se aplicó.
 */
export async function saveProduct(
  p: Partial<SupaProduct> & { barcode: string },
  opts: SaveProductOptions = {}
): Promise<{ stockError?: string }> {
  const res = await fetch("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...buildProductPayload(p),
      // v2: los null del formulario son intencionales (quitar oferta, foto…).
      v: 2,
      ...(opts.crear ? { crear: true } : {}),
      ...(opts.stockAnterior !== undefined ? { stockAnterior: opts.stockAnterior } : {}),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && data?.existente) {
    throw new ProductExistsError(data.error || "Ese código ya existe", data.existente);
  }
  if (!res.ok) {
    throw new Error(data?.error || "Error al guardar el producto");
  }
  return data?.stockError ? { stockError: String(data.stockError) } : {};
}

/** Un producto por código exacto, incluidos los desactivados. */
export async function fetchProductByBarcode(barcode: string): Promise<ProductUI | null> {
  const res = await fetch(`/api/inventario/buscar?barcode=${encodeURIComponent(barcode)}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { producto?: ProductUI | null };
  return data.producto ?? null;
}

/**
 * Cuando un alta rápida choca con un código que ya existe: se usa ese
 * producto (reactivándolo si estaba desactivado — si alguien lo tiene en la
 * mano en el local, existe) en vez de sobrescribirlo con una ficha vacía.
 */
export async function usarProductoExistente(barcode: string): Promise<ProductUI | null> {
  const p = await fetchProductByBarcode(barcode);
  if (!p) return null;
  if (p.isActive === false) {
    await saveProduct({ barcode, is_active: true });
    return { ...p, isActive: true };
  }
  return p;
}

// ── Ficha y edición parcial (PATCH) ──────────────────────────────────────

/** Fila tal como está en la base (sin redondear): es la base del `expected`. */
export type FilaProducto = SupaProduct & Record<string, unknown>;

export interface Ficha {
  fila: FilaProducto;
  producto: ProductUI;
  /** El costo lo fija un proveedor: se muestra sólo para mirar. */
  costoDelProveedor: boolean;
  /** Stock en la sucursal activa (lo que ajusta "Ajustar stock"). */
  stockSucursal: number;
  branchId: string | null;
}

/** Otra persona cambió el mismo campo mientras se editaba. */
export class ProductConflictError extends Error {
  constructor(message: string, readonly fila: FilaProducto, readonly producto: ProductUI) {
    super(message);
    this.name = "ProductConflictError";
  }
}

/**
 * Quién está atendiendo el mostrador (selector "¿Quién atiende?"), para dejarlo
 * como responsable de los cambios de precio. Si todavía no hay selector, null.
 */
export function quienAtiende(): string | null {
  try {
    const raw = localStorage.getItem("pos.attendant.v1");
    if (!raw) return null;
    const v = JSON.parse(raw) as { name?: unknown };
    return typeof v?.name === "string" && v.name.trim() ? v.name.trim() : null;
  } catch {
    return null;
  }
}

/** La ficha fresca de un producto (incluidos los desactivados). null si no existe. */
export async function fetchFicha(barcode: string, branchId?: string | null): Promise<Ficha | null> {
  const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
  const res = await fetch(`/api/products/${encodeURIComponent(barcode)}${qs}`, { cache: "no-store" });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "No se pudo abrir la ficha");
  return data as Ficha;
}

/**
 * Guarda sólo lo que cambió. `expected` lleva el valor original de cada campo
 * cambiado; si en la base ya es otro, lanza `ProductConflictError`.
 */
export async function patchProduct(
  barcode: string,
  changes: Record<string, unknown>,
  expected: Record<string, unknown>
): Promise<{ fila: FilaProducto; producto: ProductUI; aviso?: string }> {
  const res = await fetch(`/api/products/${encodeURIComponent(barcode)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes, expected, atiende: quienAtiende() }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && data?.conflicto) {
    throw new ProductConflictError(data.error, data.fila, data.producto);
  }
  if (!res.ok) throw new Error(data?.error || "No se pudo guardar");
  return data;
}

/** "Ajustar stock": cantidad real ahora, con motivo. Idempotente por `opId`. */
export async function ajustarStock(input: {
  barcode: string;
  stock: number;
  stockVisto: number;
  motivo: string;
  opId: string;
  branchId?: string | null;
}): Promise<{ ok: true; stock: number } | { ok: false; error: string; stockActual?: number }> {
  const { barcode, ...resto } = input;
  const res = await fetch(`/api/products/${encodeURIComponent(barcode)}/stock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...resto, atiende: quienAtiende() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error || "No se pudo ajustar", stockActual: data?.stock };
  return { ok: true, stock: Number(data.stock) };
}

/** Productos desactivados (filtro "Inactivos"). */
export async function fetchInactivos(): Promise<ProductUI[]> {
  const res = await fetch("/api/products?estado=inactivos", { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudieron cargar los inactivos");
  const data = (await res.json()) as { items?: ProductUI[] };
  return data.items ?? [];
}

export async function fetchCategorias(): Promise<string[]> {
  const res = await fetch("/api/products/categorias", { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { categorias?: string[] };
  return data.categorias ?? [];
}

/** Corrige el código de barras (sólo ADMIN). Devuelve el código que quedó. */
export async function cambiarCodigo(barcode: string, nuevo: string): Promise<string> {
  const res = await fetch(`/api/products/${encodeURIComponent(barcode)}/codigo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nuevo, atiende: quienAtiende() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "No se pudo cambiar el código");
  return String(data.barcode);
}

/** Sube la foto (ya comprimida) y la deja como imagen del producto. */
export async function subirFoto(
  barcode: string,
  foto: Blob
): Promise<{ url: string; fila: FilaProducto; producto: ProductUI }> {
  const form = new FormData();
  form.append("file", foto, "foto.jpg");
  const res = await fetch(`/api/products/${encodeURIComponent(barcode)}/foto`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "No se pudo subir la foto");
  return data;
}
