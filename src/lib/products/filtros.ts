import type { ProductUI } from "@/types";

/** Imagen que se muestra cuando el producto no tiene foto (ver services/products). */
const SIN_FOTO = "/file.svg";

export type FiltroProducto =
  | "sinPrecio"
  | "sinCosto"
  | "sinCategoria"
  | "sinFoto"
  | "sinStock"
  | "bajoMinimo"
  | "conOferta"
  | "inactivos";

export const ETIQUETA_FILTRO: Record<FiltroProducto, string> = {
  sinPrecio: "Sin precio",
  sinCosto: "Sin costo",
  sinCategoria: "Sin categoría",
  sinFoto: "Sin foto",
  sinStock: "Sin stock",
  bajoMinimo: "Bajo mínimo",
  conOferta: "Con oferta",
  inactivos: "Inactivos",
};

/**
 * Filtros que ve cada rol. "Sin costo" sólo sirve a quien puede cargarlo
 * (ADMIN); a la vendedora le sirven "Sin precio", "Con oferta" e "Inactivos".
 */
export function filtrosParaRol(esAdmin: boolean): FiltroProducto[] {
  return esAdmin
    ? ["sinPrecio", "sinCosto", "inactivos", "conOferta", "bajoMinimo", "sinStock", "sinCategoria", "sinFoto"]
    : ["sinPrecio", "inactivos", "conOferta", "bajoMinimo", "sinStock"];
}

/** ¿Cumple el filtro? ("inactivos" se resuelve aparte: viene de otra consulta). */
export function cumpleFiltro(p: ProductUI, f: FiltroProducto): boolean {
  switch (f) {
    case "sinPrecio":
      return !(p.price > 0);
    case "sinCosto":
      return !p.costoProveedor && !(Number(p.purchasePrice) > 0);
    case "sinCategoria":
      return p.categories.length === 0;
    case "sinFoto":
      return !p.image || p.image === SIN_FOTO;
    case "sinStock":
      return !(p.stock > 0);
    case "bajoMinimo":
      return p.minStock !== undefined && p.minStock !== null && p.stock < p.minStock;
    case "conOferta":
      return Number(p.offerPrice) > 0;
    case "inactivos":
      return p.isActive === false;
  }
}

/** Cuántos productos cumple cada filtro, para mostrar el número en el chip. */
export function contarFiltros(
  productos: ProductUI[],
  filtros: FiltroProducto[],
  inactivos: number | null
): Partial<Record<FiltroProducto, number | null>> {
  const out: Partial<Record<FiltroProducto, number | null>> = {};
  for (const f of filtros) {
    out[f] = f === "inactivos" ? inactivos : productos.filter((p) => cumpleFiltro(p, f)).length;
  }
  return out;
}
