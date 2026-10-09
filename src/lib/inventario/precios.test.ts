import { describe, expect, it } from "vitest";
import {
  MARGEN_POR_DEFECTO,
  TASA_IVA,
  aBruto,
  aNeto,
  formatoMargen,
  margenReal,
  precioSugerido,
  redondear,
  reglaDeMargen,
  sugerirDesdeFactura,
} from "./precios";

// Los primeros bloques son los tests de OlivoWeb (src/__tests__/pricing.test.ts)
// para las funciones copiadas: si divergen, el POS sugiere otro precio que la web.

describe("IVA", () => {
  it("quita y pone el 19% sin perder el valor original", () => {
    expect(aNeto(11900)).toBeCloseTo(10000, 6);
    expect(aBruto(10000)).toBeCloseTo(11900, 6);
    expect(aBruto(aNeto(11900)!)).toBeCloseTo(11900, 6);
    expect(TASA_IVA).toBe(19);
  });

  it("devuelve null en vez de NaN o Infinity", () => {
    expect(aNeto(NaN)).toBeNull();
    expect(aBruto(Infinity)).toBeNull();
    expect(aNeto(100, -100)).toBeNull();
  });
});

describe("precio sugerido", () => {
  it("35% de margen sobre el costo con IVA equivale a dividir por 0,65", () => {
    expect(precioSugerido(1000, 0.35)).toBeCloseTo(1000 / 0.65, 6);
    expect(precioSugerido(1000)).toBeCloseTo(1000 / 0.65, 6);
    expect(MARGEN_POR_DEFECTO).toBe(0.35);
  });

  it("bordes: 0 %, costo 0, 100 % y negativos", () => {
    expect(precioSugerido(1234, 0)).toBe(1234);
    expect(precioSugerido(0, 0.35)).toBe(0);
    expect(precioSugerido(1000, 1)).toBeNull();
    expect(precioSugerido(1000, -0.1)).toBeNull();
    expect(precioSugerido(-1000, 0.35)).toBeNull();
  });

  it("margen real es el inverso del sugerido", () => {
    expect(margenReal(precioSugerido(1000, 0.35)!, 1000)).toBeCloseTo(0.35, 6);
    expect(margenReal(900, 1000)).toBeCloseTo(-0.1111, 3);
    expect(margenReal(0, 1000)).toBeNull();
  });
});

describe("redondeo comercial", () => {
  it("siempre sube", () => {
    expect(redondear(1231, "decena")).toBe(1240);
    expect(redondear(1231, "centena")).toBe(1300);
    expect(redondear(1231, "terminacion90")).toBe(1290);
    expect(redondear(1231, "ninguno")).toBe(1231);
  });

  it("deja quieto lo justo y no se engaña con la coma flotante", () => {
    expect(redondear(1240, "decena")).toBe(1240);
    expect(redondear(1290, "terminacion90")).toBe(1290);
    expect(redondear(1291, "terminacion90")).toBe(1390);
    expect(redondear(1289.9999999997, "terminacion90")).toBe(1290);
    expect(redondear(1240.0000000001, "decena")).toBe(1240);
  });

  it("cero y basura", () => {
    expect(redondear(0, "decena")).toBe(0);
    expect(redondear(-10, "centena")).toBe(0);
    expect(redondear(NaN, "decena")).toBeNull();
  });
});

describe("reglaDeMargen", () => {
  const reglas = [
    { category: "__default__", margin: "0.350", rounding: "decena" },
    { category: "Bebidas", margin: 0.25, rounding: "terminacion90" },
  ];

  it("el margen propio del producto manda", () => {
    expect(reglaDeMargen({ category: "Bebidas", margin_override: 0.2 }, reglas)).toEqual({
      margen: 0.2,
      redondeo: "terminacion90",
      origen: "producto",
    });
  });

  it("luego el de la categoría, luego el general", () => {
    expect(reglaDeMargen({ category: "Bebidas" }, reglas)).toMatchObject({ margen: 0.25, origen: "categoria" });
    expect(reglaDeMargen({ category: "Aseo" }, reglas)).toEqual({
      margen: 0.35,
      redondeo: "decena",
      origen: "general",
    });
  });

  it("sin reglas cargadas, 35 % y a la decena", () => {
    expect(reglaDeMargen({ category: null, margin_override: null }, [])).toEqual({
      margen: 0.35,
      redondeo: "decena",
      origen: "general",
    });
  });

  it("ignora márgenes imposibles", () => {
    expect(reglaDeMargen({ margin_override: 1.5 }, [])).toMatchObject({ margen: 0.35 });
  });
});

describe("sugerirDesdeFactura", () => {
  it("factura $1.190 con IVA → $1.840 con 35 % a la decena (igual que calcularPrecio de OlivoWeb)", () => {
    expect(sugerirDesdeFactura(1190, { margen: 0.35, redondeo: "decena" })).toBe(1840);
  });

  it("respeta margen y redondeo de la categoría", () => {
    expect(sugerirDesdeFactura(1190, { margen: 0.4, redondeo: "terminacion90" })).toBe(1990);
  });

  it("sin costo no sugiere", () => {
    expect(sugerirDesdeFactura(0, { margen: 0.35, redondeo: "decena" })).toBeNull();
    expect(sugerirDesdeFactura(NaN, { margen: 0.35, redondeo: "decena" })).toBeNull();
  });

  it("formatea el margen en chileno", () => {
    expect(formatoMargen(0.35)).toBe("35 %");
    expect(formatoMargen(0.325)).toBe("32,5 %");
    expect(formatoMargen(null)).toBe("—");
  });
});
