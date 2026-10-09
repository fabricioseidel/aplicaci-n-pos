import { describe, expect, it } from "vitest";
import { contarFiltros, cumpleFiltro, filtrosParaRol } from "./filtros";
import type { ProductUI } from "@/types";

const base: ProductUI = {
  id: "1", name: "x", price: 1000, image: "/file.svg", slug: "x", description: "",
  categories: [], stock: 3,
};

describe("filtros de productos", () => {
  it("cada uno reconoce lo suyo", () => {
    expect(cumpleFiltro({ ...base, price: 0 }, "sinPrecio")).toBe(true);
    expect(cumpleFiltro(base, "sinCosto")).toBe(true);
    expect(cumpleFiltro({ ...base, purchasePrice: 500 }, "sinCosto")).toBe(false);
    expect(cumpleFiltro({ ...base, costoProveedor: true }, "sinCosto")).toBe(false);
    expect(cumpleFiltro({ ...base, minStock: 5 }, "bajoMinimo")).toBe(true);
    expect(cumpleFiltro({ ...base, offerPrice: 900 }, "conOferta")).toBe(true);
    expect(cumpleFiltro({ ...base, stock: 0 }, "sinStock")).toBe(true);
  });

  it("la vendedora no ve 'Sin costo'", () => {
    expect(filtrosParaRol(false)).not.toContain("sinCosto");
    expect(filtrosParaRol(true)).toContain("sinCosto");
  });

  it("cuenta por filtro; inactivos viene de afuera", () => {
    const c = contarFiltros([base, { ...base, id: "2", price: 0 }], ["sinPrecio", "inactivos"], 4);
    expect(c).toEqual({ sinPrecio: 1, inactivos: 4 });
  });
});
