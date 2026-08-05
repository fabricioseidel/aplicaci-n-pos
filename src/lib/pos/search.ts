import type { ProductUI } from "@/types";

/**
 * Búsqueda del mostrador: se escribe rápido, mal y a medias.
 *
 * Un `includes` sobre el nombre completo obliga a escribir el nombre tal cual
 * está cargado — "coca lata" no encuentra "Coca cola lata" porque en el medio
 * hay una palabra. Acá la consulta se parte en palabras y se exige que
 * **todas** aparezcan, en cualquier orden y en cualquier parte del nombre o del
 * código. Eso cubre el caso real: el cajero recuerda dos pedazos del nombre,
 * no la cadena exacta.
 *
 * No hay tolerancia a errores de tipeo a propósito: en una caja, un resultado
 * de más que se parece al que buscabas es peor que ninguno.
 */

/** minúsculas y sin tildes: "Piñita" y "pinita" tienen que ser lo mismo. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function haystack(p: ProductUI): string {
  return normalize(`${p.name} ${p.id} ${p.barcode ?? ""}`);
}

/** Palabras de la consulta, ya normalizadas y sin vacíos. */
export function queryTokens(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

export function matchesTokens(p: ProductUI, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = haystack(p);
  return tokens.every((t) => hay.includes(t));
}

/**
 * Menor es mejor. Ordena lo que ya coincidió para que lo más obvio quede
 * arriba: primero lo que empieza con lo escrito, después lo que lo tiene al
 * principio de alguna palabra, y a igualdad gana el nombre más corto —
 * "Coca cola lata" antes que "Pack Coca cola lata x6".
 */
function score(p: ProductUI, tokens: string[], rawQuery: string): number {
  const name = normalize(p.name);
  if (name.startsWith(rawQuery)) return 0;
  if (tokens.every((t) => new RegExp(`\\b${escapeRegExp(t)}`).test(name))) return 1;
  if (tokens.every((t) => name.includes(t))) return 2;
  return 3; // coincidió sólo por código de barras
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Filtra y ordena el catálogo para una consulta escrita a mano. */
export function searchProducts(products: ProductUI[], query: string): ProductUI[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return products;

  const raw = normalize(query.trim());

  return products
    .filter((p) => matchesTokens(p, tokens))
    .map((p, i) => ({ p, s: score(p, tokens, raw), i }))
    .sort((a, b) => a.s - b.s || a.p.name.length - b.p.name.length || a.i - b.i)
    .map(({ p }) => p);
}
