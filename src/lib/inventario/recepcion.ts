import type { ProductUI } from "@/types";
import { parseCantidad } from "@/lib/num";
import { aBruto, sugerirDesdeFactura, type ReglaMargen } from "./precios";

/**
 * Recepción en curso guardada en el teléfono, como el carrito: cambiar de
 * pestaña (o que Android cierre la app con la cámara abierta) no puede
 * borrar 30 productos ya escaneados de una factura.
 */
export const recepcionKey = (modo: "reception" | "transfer") => `pos.recepcion.v1.${modo}`;

export interface LineaGuardada {
  product: ProductUI;
  quantity: number;
  /** Creado en esta recepción: se le ofrece el precio sugerido aunque no se tipee costo. */
  nuevo?: boolean;
}

export interface RecepcionGuardada {
  items: LineaGuardada[];
  savedAt: number;
}

/** Lee lo guardado; cualquier cosa rara se descarta (mejor vacío que roto). */
export function parseRecepcion(raw: string | null): RecepcionGuardada | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<RecepcionGuardada>;
    if (!Array.isArray(d.items)) return null;
    const items = d.items.filter(
      (i): i is LineaGuardada =>
        !!i &&
        !!i.product &&
        typeof i.product.id === "string" &&
        typeof i.quantity === "number" &&
        Number.isFinite(i.quantity) &&
        i.quantity > 0
    );
    return { items, savedAt: Number(d.savedAt) || 0 };
  } catch {
    return null;
  }
}

/**
 * Cantidad tipeada en una línea. Por peso acepta decimales ("1,5" kg); por
 * unidad solo enteros: "2,5" latas es un error de tipeo, no media lata.
 */
export function cantidadDesdeTexto(texto: string, porPeso: boolean): number | null {
  const n = parseCantidad(texto);
  if (n === null || n <= 0) return null;
  if (!porPeso && !Number.isInteger(n)) return null;
  // Un código de barras tipeado en la cantidad no es una cantidad.
  if (n > 100_000) return null;
  return porPeso ? Math.round(n * 1000) / 1000 : n;
}

/** Lo que el servidor sabe de un producto para recibirlo (ver `GET /api/inventario/recepcion`). */
export interface InfoRecepcion {
  barcode: string;
  /** `sale_price` sin redondear: va como `expected` del PATCH. */
  precio: number | null;
  /** `purchase_price` neto sin redondear; `null` si no hay o si quien pregunta no lo ve. */
  costoNeto: number | null;
  /** El costo lo fija un proveedor: aquí es solo lectura. */
  costoDelProveedor: boolean;
  regla: ReglaMargen;
}

/** Costo con IVA en pesos enteros, como viene en la factura. */
export function costoBruto(costoNeto: number | null): number | null {
  if (costoNeto === null || !(costoNeto > 0)) return null;
  const b = aBruto(costoNeto);
  return b === null ? null : Math.round(b);
}

export interface Sugerencia {
  /** Precio de venta sugerido, redondeado hacia arriba. */
  precio: number;
  /** Costo con IVA usado para calcularlo. */
  costoBruto: number;
  margen: number;
}

/**
 * ¿Hay que ofrecer actualizar el precio de venta? Sí cuando el producto es
 * nuevo o cuando se tipeó un costo de factura distinto del actual, y el
 * sugerido no coincide ya con el precio puesto.
 */
export function sugerenciaDePrecio(input: {
  info: InfoRecepcion;
  nuevo: boolean;
  /** Costo de la factura tipeado (con IVA). `null` si no se tipeó. */
  costoFactura: number | null;
}): Sugerencia | null {
  const { info, nuevo, costoFactura } = input;
  const actual = costoBruto(info.costoNeto);
  const cambio = costoFactura !== null && costoFactura > 0 && costoFactura !== actual;
  if (!nuevo && !cambio) return null;
  const base = cambio ? costoFactura : actual;
  if (base === null) return null;
  const precio = sugerirDesdeFactura(base, info.regla);
  if (precio === null || precio <= 0) return null;
  if (info.precio !== null && Math.round(info.precio) === precio) return null;
  return { precio, costoBruto: base, margen: info.regla.margen };
}
