import type { ProductUI } from "@/types";

/** Línea del carrito: unidades, o kilos (decimal) para los productos por peso. */
export interface CartLine extends ProductUI {
  quantity: number;
  /**
   * Precio unitario sólo para esta venta (descuento puntual). La ficha no
   * cambia: la diferencia viaja como `discount` de la línea.
   */
  precioEspecial?: number;
}

/** Venta en curso tal como se guarda en el teléfono. */
export interface SaleDraft {
  items: CartLine[];
  compraPropia: boolean;
  porCobrar: boolean;
  /** `sellers.id` + nombre de quien compra (compra propia). */
  comprador: { id: string; name: string } | null;
  savedAt: number;
}

export const CART_KEY = "pos.cart.v1";

export const EMPTY_DRAFT: SaleDraft = {
  items: [],
  compraPropia: false,
  porCobrar: false,
  comprador: null,
  savedAt: 0,
};

/** Lee la venta guardada; cualquier cosa rara se descarta (mejor vacío que roto). */
export function parseDraft(raw: string | null): SaleDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<SaleDraft>;
    if (!Array.isArray(d.items)) return null;
    const items = d.items.filter(
      (i): i is CartLine =>
        !!i && typeof i.id === "string" && Number.isFinite(i.quantity) && i.quantity > 0
    );
    return {
      items,
      compraPropia: !!d.compraPropia,
      porCobrar: !!d.porCobrar,
      comprador:
        d.comprador && typeof d.comprador.id === "string"
          ? { id: d.comprador.id, name: String(d.comprador.name ?? "") }
          : null,
      savedAt: Number(d.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Trae los precios del catálogo recién cargado a las líneas guardadas. Una
 * venta retomada se cobra con el precio de hoy, y se avisa cuáles cambiaron.
 */
export function refreshPrices(
  items: CartLine[],
  catalog: ProductUI[]
): { items: CartLine[]; changed: string[] } {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const changed: string[] = [];
  const next = items.map((line) => {
    const p = byId.get(line.id);
    if (!p) return line;
    if (p.price !== line.price || (p.offerPrice ?? 0) !== (line.offerPrice ?? 0)) {
      changed.push(p.name);
    }
    return { ...line, ...p, quantity: line.quantity };
  });
  return { items: next, changed };
}
