import { describe, expect, it } from "vitest";
import { ofertaVigente, precioUnitario, totalEsperado } from "./precios";

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

describe("oferta con fecha de término", () => {
  const ahora = Date.parse("2026-10-15T12:00:00-03:00");

  it("sin fecha la oferta no vence", () => {
    expect(ofertaVigente(300, null, ahora)).toBe(true);
    expect(precioUnitario({ sale_price: 330, offer_price: 300, offer_ends_at: null }, ahora)).toBe(300);
  });

  it("con fecha futura manda la oferta", () => {
    const f = { sale_price: 330, offer_price: 300, offer_ends_at: "2026-10-15T23:59:59-03:00" };
    expect(precioUnitario(f, ahora)).toBe(300);
  });

  it("vencida se cobra el precio normal", () => {
    const f = { sale_price: 330, offer_price: 300, offer_ends_at: "2026-10-14T23:59:59-03:00" };
    expect(precioUnitario(f, ahora)).toBe(330);
    const vieja = { ...f, offer_ends_at: "2020-01-01T00:00:00Z" }; // totalEsperado usa la hora real
    expect(totalEsperado([{ barcode: "pan", qty: 2 }], new Map([["pan", vieja]]), false).total).toBe(660);
  });

  it("justo en el instante de término ya no vale", () => {
    expect(ofertaVigente(300, "2026-10-15T15:00:00Z", ahora)).toBe(false);
  });

  it("sin oferta da lo mismo la fecha", () => {
    expect(ofertaVigente(0, null, ahora)).toBe(false);
    expect(ofertaVigente(null, "2099-01-01T00:00:00Z", ahora)).toBe(false);
  });
});
