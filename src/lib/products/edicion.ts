/**
 * Edición de productos: qué cambió, qué se puede cambiar y cuándo pedir
 * confirmación. Todo puro (sin red ni base) para poder testearlo.
 *
 * Regla de oro: un guardado sólo manda los campos que la persona tocó. Antes
 * cada guardado reenviaba el formulario entero con 0/null por defecto y borraba
 * el costo y los mínimos del producto, y reenviaba el stock que mostraba la
 * pantalla, revirtiendo las ventas hechas mientras la ficha estaba abierta. El
 * stock NUNCA se cambia desde la ficha: va por "Ajustar stock".
 */

/** Columnas de `products` que la ficha puede cambiar. `stock` no está, a propósito. */
export const CAMPOS_EDITABLES = [
  "name",
  "category",
  "sale_price",
  "offer_price",
  "purchase_price",
  "min_stock",
  "optimum_stock",
  "by_weight",
  "measurement_unit",
  "image_url",
  "is_active",
  "description",
] as const;

export type CampoEditable = (typeof CAMPOS_EDITABLES)[number];
export type ValorCampo = string | number | boolean | null;
export type Cambios = Partial<Record<CampoEditable, ValorCampo>>;

const esCampo = (k: string): k is CampoEditable =>
  (CAMPOS_EDITABLES as readonly string[]).includes(k);

/** "" y undefined valen lo mismo que null; los números se comparan como números. */
function normal(v: unknown): ValorCampo {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  return null;
}

function iguales(a: ValorCampo, b: ValorCampo): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  return a === b;
}

/**
 * Compara la fila original (tal como vino de la base, sin redondear) con lo
 * editado y devuelve sólo lo que cambió.
 *
 * `expected` lleva el valor ORIGINAL de cada campo cambiado: el servidor
 * actualiza sólo si la base sigue teniendo ese valor, y si otra persona cambió
 * el mismo campo entretanto responde 409 en vez de pisarlo en silencio.
 */
export function diffProduct(
  original: Record<string, unknown>,
  editado: Partial<Record<string, unknown>>
): { changes: Cambios; expected: Cambios } {
  const changes: Cambios = {};
  const expected: Cambios = {};
  for (const [k, v] of Object.entries(editado)) {
    if (!esCampo(k) || v === undefined) continue;
    const antes = normal(original[k]);
    const despues = normal(v);
    if (!iguales(antes, despues)) {
      changes[k] = despues;
      expected[k] = antes;
    }
  }
  return { changes, expected };
}

export type ResultadoValidacion =
  | { ok: true; changes: Cambios }
  | { ok: false; error: string };

const entero = (v: unknown) => typeof v === "number" && Number.isInteger(v);

/**
 * Valida un `changes` que llega del cliente. Rechaza `stock` y cualquier campo
 * que no sea editable desde la ficha.
 */
export function validarCambios(input: unknown): ResultadoValidacion {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "No hay cambios" };
  }
  const out: Cambios = {};
  for (const [k, raw] of Object.entries(input as Record<string, unknown>)) {
    if (k === "stock") {
      return { ok: false, error: "El stock no se cambia desde la ficha: usa «Ajustar stock»" };
    }
    if (!esCampo(k)) return { ok: false, error: `Campo no editable: ${k}` };
    const v = raw === undefined ? null : raw;

    switch (k) {
      case "name": {
        const n = normal(v);
        if (typeof n !== "string" || n.length > 200) return { ok: false, error: "El nombre es obligatorio" };
        out.name = n;
        break;
      }
      case "sale_price":
        if (!entero(v) || (v as number) < 1 || (v as number) > 10_000_000) {
          return { ok: false, error: "El precio tiene que ser un monto en pesos mayor que 0" };
        }
        out.sale_price = v as number;
        break;
      case "offer_price":
        if (v !== null && (!entero(v) || (v as number) < 1)) {
          return { ok: false, error: "Precio de oferta inválido" };
        }
        out.offer_price = v as number | null;
        break;
      case "purchase_price":
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
          return { ok: false, error: "Costo inválido" };
        }
        out.purchase_price = Math.round(v * 100) / 100;
        break;
      case "min_stock":
      case "optimum_stock":
        if (v !== null && (!entero(v) || (v as number) < 0)) {
          return { ok: false, error: "El stock mínimo y el óptimo son cantidades enteras" };
        }
        out[k] = v as number | null;
        break;
      case "by_weight":
      case "is_active":
        if (typeof v !== "boolean") return { ok: false, error: `Valor inválido para ${k}` };
        out[k] = v;
        break;
      case "measurement_unit":
        if (v !== null && v !== "kg" && v !== "g") return { ok: false, error: "Unidad inválida" };
        out.measurement_unit = v as string | null;
        break;
      case "category":
      case "image_url":
      case "description": {
        if (v !== null && typeof v !== "string") return { ok: false, error: `Valor inválido para ${k}` };
        out[k] = normal(v);
        break;
      }
    }
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "No hay cambios" };
  return { ok: true, changes: out };
}

// ── Costo, IVA y margen ──────────────────────────────────────────────────
// Mismas reglas que OlivoWeb (`src/lib/pricing.ts`): el costo se guarda NETO
// y el margen se calcula sobre el precio de venta con el costo CON IVA.

export const TASA_IVA = 19;

/** Lo que se paga (con IVA) → lo que se guarda en `purchase_price` (neto). */
export function costoNetoDesdeBruto(bruto: number): number {
  return Math.round((bruto / (1 + TASA_IVA / 100)) * 100) / 100;
}

/** `purchase_price` (neto) → lo que se pagó con IVA, en pesos enteros. */
export function costoBrutoDesdeNeto(neto: number): number {
  return Math.round(neto * (1 + TASA_IVA / 100));
}

/** Margen sobre la venta (0,35 = 35 %). `null` si no hay datos para calcularlo. */
export function margenSobreVenta(precio: number | null, costoBruto: number | null): number | null {
  if (!precio || precio <= 0 || costoBruto === null || costoBruto <= 0) return null;
  return (precio - costoBruto) / precio;
}

// ── Topes: cuándo un precio pide confirmación ────────────────────────────

/** Precio que siempre pide confirmar: un código de barras escrito como precio cae acá. */
export const PRECIO_MAXIMO_SIN_CONFIRMAR = 100_000;
/** Precio tan bajo que probablemente es un error de tipeo ("3.5" en vez de 3.500). */
export const PRECIO_MINIMO_SIN_CONFIRMAR = 50;
/** Cambio relativo que pide confirmar (0,5 = 50 %). */
export const CAMBIO_MAXIMO_SIN_CONFIRMAR = 0.5;

/**
 * Avisos que obligan a confirmar un precio antes de guardarlo. Vacío = se
 * guarda sin preguntar. Un producto nuevo o sin precio no tiene "antes", así
 * que para él sólo valen los topes absolutos.
 */
export function revisarPrecio(anterior: number | null | undefined, nuevo: number): string[] {
  const avisos: string[] = [];
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
  if (nuevo > PRECIO_MAXIMO_SIN_CONFIRMAR) avisos.push(`El precio es muy alto: ${fmt(nuevo)}`);
  if (nuevo < PRECIO_MINIMO_SIN_CONFIRMAR) avisos.push(`El precio es muy bajo: ${fmt(nuevo)}`);
  if (anterior && anterior > 0) {
    const cambio = Math.abs(nuevo - anterior) / anterior;
    if (cambio > CAMBIO_MAXIMO_SIN_CONFIRMAR) {
      const pct = Math.round(cambio * 100);
      avisos.push(`El precio cambia ${pct} %: antes ${fmt(anterior)}, ahora ${fmt(nuevo)}`);
    }
  }
  return avisos;
}

/** La oferta tiene que ser menor que el precio, o no es oferta. */
export function revisarOferta(precio: number | null, oferta: number | null): string[] {
  if (oferta === null || !precio) return [];
  return oferta >= precio
    ? [`La oferta ($${oferta.toLocaleString("es-CL")}) no es menor que el precio ($${precio.toLocaleString("es-CL")})`]
    : [];
}

// ── Ajuste de stock ──────────────────────────────────────────────────────

export const MOTIVOS_AJUSTE = [
  "Merma",
  "Rotura",
  "Vencido",
  "Devolución a proveedor",
  "Consumo del local",
  "Corrección",
] as const;
export type MotivoAjuste = (typeof MOTIVOS_AJUSTE)[number];

export const esMotivoAjuste = (m: unknown): m is MotivoAjuste =>
  typeof m === "string" && (MOTIVOS_AJUSTE as readonly string[]).includes(m);

/** Una fila de "Precios cambiados hoy" (`GET /api/products/cambios`). */
export interface CambioDePrecioHoy {
  cuando: string;
  quien: string;
  barcode: string;
  nombre: string | null;
  campo: "sale_price" | "offer_price";
  antes: number | null;
  despues: number | null;
}
