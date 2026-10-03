import { describe, expect, it } from "vitest";
import { avisoDevolucion, puedeAnular, resumenProductos } from "./anular";

const ahora = new Date("2026-10-01T15:00:00Z");
const hace = (min: number) => new Date(ahora.getTime() - min * 60000).toISOString();

describe("puedeAnular", () => {
  it("ADMIN siempre, aunque sea de otro turno y de ayer", () => {
    expect(
      puedeAnular({ rol: "ADMIN", venta: { ts: hace(60 * 24), shift_id: "viejo" }, turnoAbiertoId: "t1", ahora })
    ).toEqual({ ok: true });
  });

  it("vendedora: turno abierto y dentro de 30 min", () => {
    expect(
      puedeAnular({ rol: "SELLER", venta: { ts: hace(29), shift_id: "t1" }, turnoAbiertoId: "t1", ahora }).ok
    ).toBe(true);
    expect(
      puedeAnular({ rol: "SELLER", venta: { ts: hace(30), shift_id: "t1" }, turnoAbiertoId: "t1", ahora }).ok
    ).toBe(true);
  });

  it("vendedora: más de 30 min → no", () => {
    const r = puedeAnular({ rol: "SELLER", venta: { ts: hace(31), shift_id: "t1" }, turnoAbiertoId: "t1", ahora });
    expect(r.ok).toBe(false);
  });

  it("vendedora: venta de un turno cerrado o sin turno → no", () => {
    expect(
      puedeAnular({ rol: "SELLER", venta: { ts: hace(5), shift_id: "t0" }, turnoAbiertoId: "t1", ahora }).ok
    ).toBe(false);
    expect(
      puedeAnular({ rol: "SELLER", venta: { ts: hace(5), shift_id: null }, turnoAbiertoId: null, ahora }).ok
    ).toBe(false);
  });

  it("una anulada no se vuelve a anular, ni un USER puede", () => {
    expect(
      puedeAnular({ rol: "ADMIN", venta: { ts: hace(1), shift_id: "t1", voided: true }, turnoAbiertoId: "t1", ahora }).ok
    ).toBe(false);
    expect(
      puedeAnular({ rol: "USER", venta: { ts: hace(1), shift_id: "t1" }, turnoAbiertoId: "t1", ahora }).ok
    ).toBe(false);
  });

  it("fecha ilegible → no (no se asume reciente)", () => {
    expect(
      puedeAnular({ rol: "SELLER", venta: { ts: "basura", shift_id: "t1" }, turnoAbiertoId: "t1", ahora }).ok
    ).toBe(false);
  });
});

describe("avisoDevolucion", () => {
  it("mixta: efectivo a devolver y tarjeta a reversar", () => {
    const avisos = avisoDevolucion({
      id: 6,
      total: 8070,
      sale_payments: [
        { method: "CASH", amount: 5000 },
        { method: "CARD", amount: "3070.00" },
      ],
    });
    expect(avisos[0]).toBe("Devuelve $ 5.000 en efectivo al cliente.");
    expect(avisos[1]).toContain("$ 3.070");
    expect(avisos).toHaveLength(2);
  });

  it("compra propia: no se devuelve plata", () => {
    const avisos = avisoDevolucion({
      id: 5,
      total: 1125,
      is_staff_purchase: true,
      sale_payments: [{ method: "STAFF_CREDIT", amount: 1125 }],
    });
    expect(avisos).toEqual(["Compra del personal $ 1.125: ya no se descontará del sueldo."]);
  });
});

describe("resumenProductos", () => {
  it("muestra los primeros con cantidad y cuántos más", () => {
    expect(
      resumenProductos([
        { product_name: "Coca lata", quantity: 3 },
        { product_name: "Papas", quantity: 1 },
        { product_name: "Pan", quantity: "0.35" },
      ])
    ).toBe("Coca lata ×3, Papas y 1 más");
    expect(resumenProductos([{ product_name: "Queso", quantity: "0.35" }])).toBe("Queso 0,35 kg");
    expect(resumenProductos([])).toBe("");
  });
});
