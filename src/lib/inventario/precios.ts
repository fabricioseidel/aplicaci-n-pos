/**
 * Precio sugerido a partir del costo, con las MISMAS reglas que OlivoWeb
 * (`OlivoWeb/src/lib/pricing.ts`, copiado tal cual en lo que se usa acá):
 *
 * 1. El costo se guarda NETO (`purchase_price`); la factura viene con IVA.
 * 2. El margen es sobre el precio de venta: 35 % es `costo_bruto / 0,65`.
 * 3. El redondeo comercial siempre sube: redondear hacia abajo se come margen.
 *
 * Si cambia una regla en OlivoWeb hay que cambiarla acá también: el dueño ve
 * los márgenes en OlivoWeb → Precios y tienen que coincidir con lo que el POS
 * le sugiere a quien recibe la mercadería.
 */

/** IVA chileno, en porcentaje. */
export const TASA_IVA = 19;

/** Margen bruto por defecto cuando ni el producto ni su categoría definen uno. */
export const MARGEN_POR_DEFECTO = 0.35;

/** Clave de la fila de respaldo en `category_margins`. */
export const CATEGORIA_POR_DEFECTO = "__default__";

export type ModoRedondeo = "ninguno" | "decena" | "terminacion90" | "centena";

const MODOS: ModoRedondeo[] = ["ninguno", "decena", "terminacion90", "centena"];

/** Corrige el error de coma flotante antes de redondear hacia arriba. */
function techo(valor: number): number {
  return Math.ceil(Number(valor.toFixed(6)));
}

function esFinito(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

/** Quita el IVA: de precio con IVA a precio neto. */
export function aNeto(bruto: number, tasa: number = TASA_IVA): number | null {
  if (!esFinito(bruto) || !esFinito(tasa) || tasa <= -100) return null;
  return bruto / (1 + tasa / 100);
}

/** Agrega el IVA: de precio neto a precio con IVA. */
export function aBruto(neto: number, tasa: number = TASA_IVA): number | null {
  if (!esFinito(neto) || !esFinito(tasa) || tasa <= -100) return null;
  return neto * (1 + tasa / 100);
}

/**
 * Precio de venta que deja el margen pedido sobre el costo con IVA. `null`
 * cuando no hay solución (margen 100 % o más, negativos).
 */
export function precioSugerido(costoBruto: number, margen: number = MARGEN_POR_DEFECTO): number | null {
  if (!esFinito(costoBruto) || !esFinito(margen)) return null;
  if (costoBruto < 0) return null;
  if (margen < 0 || margen >= 1) return null;
  return costoBruto / (1 - margen);
}

/** Margen real que deja un precio: puede ser negativo (se vende bajo el costo). */
export function margenReal(precioVenta: number, costoBruto: number): number | null {
  if (!esFinito(precioVenta) || !esFinito(costoBruto)) return null;
  if (precioVenta <= 0) return null;
  return (precioVenta - costoBruto) / precioVenta;
}

/** Redondeo comercial, siempre hacia arriba. */
export function redondear(valor: number, modo: ModoRedondeo = "decena"): number | null {
  if (!esFinito(valor)) return null;
  if (valor <= 0) return 0;
  switch (modo) {
    case "ninguno":
      return techo(valor);
    case "decena":
      return techo(valor / 10) * 10;
    case "centena":
      return techo(valor / 100) * 100;
    case "terminacion90":
      return techo((valor - 90) / 100) * 100 + 90;
    default:
      return techo(valor);
  }
}

export function comoRedondeo(valor: unknown): ModoRedondeo {
  return MODOS.includes(valor as ModoRedondeo) ? (valor as ModoRedondeo) : "decena";
}

/** Regla de margen que aplica a un producto y de dónde salió. */
export interface ReglaMargen {
  margen: number;
  redondeo: ModoRedondeo;
  origen: "producto" | "categoria" | "general";
}

/**
 * El margen del producto (`margin_override`), si no el de su categoría
 * (`category_margins`), si no el general (`__default__`), y si no hay nada el
 * 35 %. El redondeo sale de la categoría o del general. Es el mismo orden que
 * usa OlivoWeb (`pricing.service.ts`).
 */
export function reglaDeMargen(
  producto: { category?: string | null; margin_override?: unknown },
  reglas: Array<{ category: string; margin: unknown; rounding?: unknown }>
): ReglaMargen {
  const num = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n < 1 ? n : null;
  };
  const porCategoria = producto.category
    ? reglas.find((r) => r.category === producto.category && num(r.margin) !== null)
    : undefined;
  const general = reglas.find((r) => r.category === CATEGORIA_POR_DEFECTO && num(r.margin) !== null);
  const redondeo = comoRedondeo((porCategoria ?? general)?.rounding);
  const propio = num(producto.margin_override);
  if (propio !== null) return { margen: propio, redondeo, origen: "producto" };
  if (porCategoria) return { margen: num(porCategoria.margin)!, redondeo, origen: "categoria" };
  if (general) return { margen: num(general.margin)!, redondeo, origen: "general" };
  return { margen: MARGEN_POR_DEFECTO, redondeo: "decena", origen: "general" };
}

/**
 * Del costo de la factura (CON IVA, en pesos) al precio de venta sugerido,
 * ya redondeado hacia arriba. `null` si no se puede calcular.
 */
export function sugerirDesdeFactura(
  costoFacturaBruto: number,
  regla: Pick<ReglaMargen, "margen" | "redondeo">
): number | null {
  if (!esFinito(costoFacturaBruto) || costoFacturaBruto <= 0) return null;
  const exacto = precioSugerido(costoFacturaBruto, regla.margen);
  return exacto === null ? null : redondear(exacto, regla.redondeo);
}

/** 0,35 → "35 %"; 0,325 → "32,5 %". */
export function formatoMargen(margen: number | null): string {
  if (margen === null || !esFinito(margen)) return "—";
  const pct = Math.round(margen * 1000) / 10;
  return `${String(pct).replace(".", ",")} %`;
}
