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
}

/** Igual que `unitPriceOf` del carrito: la oferta manda, y se redondea a peso. */
export function precioUnitario(f: PrecioFicha): number {
  const oferta = Number(f.offer_price ?? 0);
  return Math.round(oferta > 0 ? oferta : Number(f.sale_price ?? 0));
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
