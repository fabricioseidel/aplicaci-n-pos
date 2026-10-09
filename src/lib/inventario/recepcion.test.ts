import { describe, expect, it } from "vitest";
import type { ProductUI } from "@/types";
import {
  cantidadDesdeTexto,
  costoBruto,
  parseRecepcion,
  recepcionKey,
  sugerenciaDePrecio,
  type InfoRecepcion,
} from "./recepcion";

const coca = { id: "coca", barcode: "coca", name: "Coca lata", price: 1000, stock: 5 } as ProductUI;

describe("recepción guardada", () => {
  it("una clave por modo", () => {
    expect(recepcionKey("reception")).not.toBe(recepcionKey("transfer"));
  });

  it("vuelve a leer lo guardado", () => {
    const raw = JSON.stringify({ items: [{ product: coca, quantity: 24, nuevo: true }], savedAt: 5 });
    expect(parseRecepcion(raw)).toEqual({ items: [{ product: coca, quantity: 24, nuevo: true }], savedAt: 5 });
  });

  it("descarta basura y líneas rotas", () => {
    expect(parseRecepcion(null)).toBeNull();
    expect(parseRecepcion("{no es json")).toBeNull();
    expect(parseRecepcion(JSON.stringify({ items: "x" }))).toBeNull();
    const raw = JSON.stringify({
      items: [{ product: coca, quantity: 0 }, { quantity: 2 }, { product: coca, quantity: "3" }, { product: coca, quantity: 2 }],
    });
    expect(parseRecepcion(raw)?.items).toEqual([{ product: coca, quantity: 2 }]);
  });
});

describe("cantidad tipeada", () => {
  it("24 unidades de un toque", () => {
    expect(cantidadDesdeTexto("24", false)).toBe(24);
  });
  it("por unidad no acepta decimales; por peso sí, con coma o punto", () => {
    expect(cantidadDesdeTexto("2,5", false)).toBeNull();
    expect(cantidadDesdeTexto("2,5", true)).toBe(2.5);
    expect(cantidadDesdeTexto("0.35", true)).toBe(0.35);
  });
  it("rechaza vacío, cero, negativos y un código de barras", () => {
    expect(cantidadDesdeTexto("", false)).toBeNull();
    expect(cantidadDesdeTexto("0", false)).toBeNull();
    expect(cantidadDesdeTexto("-3", false)).toBeNull();
    expect(cantidadDesdeTexto("7801610001196", false)).toBeNull();
  });
});

describe("sugerencia de precio", () => {
  const info = (p: Partial<InfoRecepcion> = {}): InfoRecepcion => ({
    barcode: "coca",
    precio: 1000,
    costoNeto: 500,
    costoDelProveedor: false,
    regla: { margen: 0.35, redondeo: "decena", origen: "general" },
    ...p,
  });

  it("costo con IVA en pesos enteros", () => {
    expect(costoBruto(500)).toBe(595);
    expect(costoBruto(null)).toBeNull();
    expect(costoBruto(0)).toBeNull();
  });

  it("sin costo nuevo ni producto nuevo no sugiere nada", () => {
    expect(sugerenciaDePrecio({ info: info(), nuevo: false, costoFactura: null })).toBeNull();
    // El mismo costo que ya tenía tampoco es un cambio.
    expect(sugerenciaDePrecio({ info: info(), nuevo: false, costoFactura: 595 })).toBeNull();
  });

  it("si sube el costo de la factura sugiere con el margen y redondeo hacia arriba", () => {
    // 1.190 / 0,65 = 1.830,77 → 1.840
    expect(sugerenciaDePrecio({ info: info(), nuevo: false, costoFactura: 1190 })).toEqual({
      precio: 1840,
      costoBruto: 1190,
      margen: 0.35,
    });
  });

  it("un producto nuevo con costo sugiere aunque no se tipee costo", () => {
    expect(sugerenciaDePrecio({ info: info({ precio: 0 }), nuevo: true, costoFactura: null })?.precio).toBe(920);
  });

  it("un producto nuevo sin costo no puede sugerir", () => {
    expect(sugerenciaDePrecio({ info: info({ costoNeto: null, precio: null }), nuevo: true, costoFactura: null })).toBeNull();
  });

  it("si el precio ya es el sugerido no insiste", () => {
    expect(sugerenciaDePrecio({ info: info({ precio: 1840 }), nuevo: false, costoFactura: 1190 })).toBeNull();
  });

  it("usa el margen de la categoría", () => {
    const r = sugerenciaDePrecio({
      info: info({ regla: { margen: 0.4, redondeo: "terminacion90", origen: "categoria" } }),
      nuevo: false,
      costoFactura: 1190,
    });
    expect(r?.precio).toBe(1990);
  });
});
