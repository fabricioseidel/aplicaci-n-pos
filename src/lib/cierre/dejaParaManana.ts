import { parseCLP } from "@/lib/num";

/**
 * "¿Cuánto dejas en la caja para mañana?"
 *
 * El dueño retira la plata del día y deja el sencillo, así que lo contado al
 * cerrar no es con lo que se abre al día siguiente. No hay columna para esto
 * (sería la migración opcional M2b): se guarda como una línea en las `notes`
 * del cierre, con un formato fijo que la apertura sabe leer y que en
 * OlivoWeb se lee igual de bien como texto.
 */
const PREFIJO = "Deja para mañana:";
const LINEA_RE = /^\s*Deja para mañana:\s*\$?\s*([\d.]+)\s*$/im;

/** Monto de "Deja para mañana: $20.000" en unas notas, o null si no está. */
export function parseDejaParaManana(notas?: string | null): number | null {
  if (!notas) return null;
  const m = notas.match(LINEA_RE);
  return m ? parseCLP(m[1]) : null;
}

/** Las notas sin la línea de "Deja para mañana" (para mostrar las observaciones). */
export function sinDejaParaManana(notas?: string | null): string {
  if (!notas) return "";
  return notas
    .split("\n")
    .filter((l) => !LINEA_RE.test(l))
    .join("\n")
    .trim();
}

/** Agrega (o reemplaza) la línea al final de las observaciones del cierre. */
export function conDejaParaManana(notas: string | null | undefined, monto: number | null): string {
  const base = sinDejaParaManana(notas);
  if (monto === null || !Number.isFinite(monto) || monto < 0) return base;
  const linea = `${PREFIJO} $${Math.round(monto).toLocaleString("es-CL")}`;
  return base ? `${base}\n${linea}` : linea;
}
