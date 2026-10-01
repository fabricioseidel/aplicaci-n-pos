/**
 * Números escritos a mano en el mostrador.
 *
 * Un `<input type="number">` en un teléfono en es-CL toma el punto como
 * decimal: "3.500" quedaba en 3,5 y "30.000" abría la caja con $30. Acá el
 * punto es siempre separador de miles, como se escribe en Chile.
 */

/** Pesos chilenos: "3.500", "$ 1.990", "30000" → entero; vacío o basura → null. */
export function parseCLP(texto: string): number | null {
  const limpio = texto.replace(/[$\s]/g, "").replace(/\./g, "");
  if (!limpio) return null;
  const normal = limpio.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  return Math.round(Number(normal));
}

/** 30000 → "30.000" (sin signo; para el valor de un campo). */
export function formatMiles(n: number): string {
  return Math.round(n).toLocaleString("es-CL");
}

/**
 * Peso en gramos. "350" → 350. Con separador decimal y menos de 50, se
 * entiende que vino en kilos: "0,35" o "0.35" → 350 y "1.2" → 1200. Así "1.200"
 * también da 1200 g, se lea como miles o como kilos.
 */
export function parseGramos(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, "");
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(\d+)[.,](\d+)$/);
  if (!m) return null;
  const valor = Number(`${m[1]}.${m[2]}`);
  if (valor < 50) return Math.round(valor * 1000);
  // "1.250" con 3 decimales y >= 50 no puede ser kilos: son miles de gramos.
  return m[2].length === 3 ? Number(m[1] + m[2]) : Math.round(valor);
}

/** Cantidad de unidades o kilos: acepta coma o punto decimal. */
export function parseCantidad(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (!t) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
