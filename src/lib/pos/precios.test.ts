import { describe, expect, it } from "vitest";
import { precioUnitario, totalEsperado } from "./precios";

const fichas = new Map([
  ["coca", { sale_price: 1000, offer_price: null }],
  ["queso", { sale_price: 11400, offer_price: null }],
  ["pan", { sale_price: 330, offer_price: 300 }],
]);

describe("precios del servidor", () => {
  it("la oferta manda", () => {
    expect(precioUnitario({ sale_price: 330, offer_price: 300 })).toBe(300);
  });

  it("redondea por línea, igual que el carrito (3 líneas por peso)", () => {
    const { total } = totalEsperado(
      [{ barcode: "queso", qty: 0.337 }, { barcode: "queso", qty: 0.211 }, { barcode: "coca", qty: 2 }],
      fichas,
      false
    );
    // 3841.8 → 3842 ; 2405.4 → 2405 ; 2000
    expect(total).toBe(3842 + 2405 + 2000);
  });

  it("descuento de personal sobre la suma", () => {
    expect(totalEsperado([{ barcode: "coca", qty: 3 }], fichas, true).total).toBe(2250);
  });

  it("informa códigos que no están en la ficha", () => {
    expect(totalEsperado([{ barcode: "x", qty: 1 }], fichas, false).faltantes).toEqual(["x"]);
  });
});

describe("precio especial (descuento por línea)", () => {
  it("resta el descuento de la línea", () => {
    expect(totalEsperado([{ barcode: "coca", qty: 3, discount: 600 }], fichas, false).total).toBe(2400);
  });

  it("no acepta descuentos negativos ni mayores que la línea", () => {
    expect(totalEsperado([{ barcode: "coca", qty: 1, discount: -500 }], fichas, false).total).toBe(1000);
    expect(totalEsperado([{ barcode: "coca", qty: 1, discount: 5000 }], fichas, false).total).toBe(0);
  });

  it("compra propia: el 25% va sobre lo que queda", () => {
    expect(totalEsperado([{ barcode: "coca", qty: 2, discount: 400 }], fichas, true).total).toBe(1200);
  });
});
