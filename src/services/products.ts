import type { SupaProduct, ProductUI } from "@/types";

export const DEFAULT_IMAGE = "/file.svg";

/** Columnas que el POS necesita de `products`. */
export const PRODUCT_COLUMNS =
  "barcode, name, category, sale_price, offer_price, purchase_price, image_url, stock, featured, is_active, by_weight, measurement_unit, measurement_value, suggested_price, min_stock, optimum_stock, description, updated_at";

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
  const rawOfferPrice = p.offer_price ? Number(p.offer_price) : undefined;

  return {
    id: String(p.barcode),
    barcode: p.barcode,
    name,
    // Para productos por peso este precio es POR KILO.
    price: Math.round(rawSalePrice),
    offerPrice: rawOfferPrice ? Math.round(rawOfferPrice) : undefined,
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
