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
 * Payload de upsert. Sólo columnas que existen de verdad en `products`
 * (verificado contra la base): mandar `tax_rate`, como hacía OlivoWeb,
 * provoca un PGRST204 que su ruta tenía que ir corrigiendo a reintentos.
 */
export function buildProductPayload(p: Partial<SupaProduct> & { barcode: string }) {
  return {
    barcode: p.barcode,
    name: p.name ?? null,
    category: p.category ?? null,
    purchase_price: p.purchase_price ?? 0,
    sale_price: p.sale_price ?? 0,
    stock: p.stock ?? 0,
    updated_at: new Date().toISOString(),
    image_url: p.image_url ?? null,
    description: p.description ?? null,
    by_weight: p.by_weight ?? false,
    measurement_unit: p.measurement_unit ?? null,
    measurement_value: p.measurement_value ?? null,
    offer_price: p.offer_price ?? null,
    is_active: p.is_active ?? true,
    min_stock: p.min_stock ?? null,
    optimum_stock: p.optimum_stock ?? null,
  };
}

/** Guarda (crea o actualiza) un producto. El upsert va por `barcode`. */
export async function saveProduct(p: Partial<SupaProduct> & { barcode: string }): Promise<void> {
  const res = await fetch("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildProductPayload(p)),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Error al guardar el producto");
  }
}
