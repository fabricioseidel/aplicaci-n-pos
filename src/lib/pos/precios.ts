/**
 * Precio que se cobra, calculado igual en el teléfono y en el servidor.
 *
 * El servidor del POS aceptaba cualquier precio que mandara el navegador
 * (una venta de 10 Cocas a $1 entraba). Ahora recalcula con la ficha: si no
 * coincide, la venta en vivo se rechaza y el teléfono se actualiza.
 */

import { STAFF_DISCOUNT_RATE } from "./payments";

export interface PrecioFicha {
  sale_price: number | null;
  offer_price: number | null;
  /** Fin de la oferta (timestamptz). NULL/ausente = sin fecha de término. */
  offer_ends_at?: string | null;
}

/**
 * La oferta se cobra sólo si existe (> 0) y no venció: `offer_ends_at` NULL
 * o futuro. Es LA regla del precio vigente; la usan el carrito
 * (`unitPriceOf`), el catálogo (`mapSupaToUI`) y el servidor.
 */
export function ofertaVigente(
  oferta: number | null | undefined,
  terminaEn: string | null | undefined,
  ahora: number = Date.now()
): boolean {
  if (!(Number(oferta ?? 0) > 0)) return false;
  if (!terminaEn) return true;
  const fin = Date.parse(terminaEn);
  // Una fecha ilegible no anula la oferta: mejor cobrar lo que dice la ficha.
  return Number.isNaN(fin) || fin > ahora;
}

/** Igual que `unitPriceOf` del carrito: la oferta vigente manda, y se redondea a peso. */
export function precioUnitario(f: PrecioFicha, ahora: number = Date.now()): number {
  const oferta = Number(f.offer_price ?? 0);
  return Math.round(ofertaVigente(oferta, f.offer_ends_at, ahora) ? oferta : Number(f.sale_price ?? 0));
}

export interface LineaVenta {
  barcode: string;
  qty: number;
}

/**
 * Total esperado: redondeo POR LÍNEA (como `lineSubtotal`), menos el
 * descuento de personal sobre la suma. Devuelve también los códigos que no
 * están en la ficha.
 */
export function totalEsperado(
  lineas: LineaVenta[],
  fichas: Map<string, PrecioFicha>,
  compraPropia: boolean
): { total: number; faltantes: string[] } {
  const faltantes: string[] = [];
  let suma = 0;
  for (const l of lineas) {
    const f = fichas.get(l.barcode);
    if (!f) {
      faltantes.push(l.barcode);
      continue;
    }
    suma += Math.round(precioUnitario(f) * Number(l.qty));
  }
  const descuento = compraPropia ? Math.round(suma * STAFF_DISCOUNT_RATE) : 0;
  return { total: suma - descuento, faltantes };
}
