/**
 * "Oferta hasta": la fecha que elige la persona (un día en Chile) y el
 * instante que se guarda en `products.offer_ends_at`.
 *
 * Se guarda el FIN del día en hora de Chile (23:59:59 America/Santiago), así
 * "hasta el 15-10" vale todo el 15 aunque el teléfono o el servidor estén en
 * otro huso. Chile cambia de horario (-03/-04), por eso el desfase se calcula
 * para esa fecha y no se fija.
 */

export const ZONA_CHILE = "America/Santiago";

const partesChile = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_CHILE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Hora de pared en Chile de un instante, como si fuera UTC (para restar). */
function paredChile(ms: number): number {
  const p: Record<string, number> = {};
  for (const { type, value } of partesChile.formatToParts(new Date(ms))) {
    if (type !== "literal") p[type] = Number(value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-15" → instante ISO de las 23:59:59 de ese día en Chile. null si la fecha no sirve. */
export function finDelDiaChile(fecha: string): string | null {
  const m = FECHA.exec(fecha.trim());
  if (!m) return null;
  const pared = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  if (Number.isNaN(pared) || new Date(pared).getUTCDate() !== Number(m[3])) return null;
  // Primera aproximación con el desfase del instante y una corrección por si
  // ese día cambia el horario.
  let ms = pared + (pared - paredChile(pared));
  ms += pared - paredChile(ms);
  return new Date(ms).toISOString();
}

/** Instante ISO → "2026-10-15" (el día en Chile). "" si no hay fecha. */
export function fechaChile(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(paredChile(ms)).toISOString().slice(0, 10);
}

/** "2026-10-15" → "15-10" (o "15-10-2027" si no es este año). */
export function fechaCorta(fecha: string, hoy: string = fechaChile(new Date().toISOString())): string {
  const m = FECHA.exec(fecha);
  if (!m) return fecha;
  return m[1] === hoy.slice(0, 4) ? `${m[3]}-${m[2]}` : `${m[3]}-${m[2]}-${m[1]}`;
}

/** Hoy en Chile, "YYYY-MM-DD". */
export function hoyChile(ahora: number = Date.now()): string {
  return fechaChile(new Date(ahora).toISOString());
}
