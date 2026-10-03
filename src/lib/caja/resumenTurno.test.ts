import { describe, expect, it } from "vitest";
import { resumenTurno, type VentaTurno } from "./resumenTurno";

const pago = (method: string, amount: number) => ({ method, amount });

// El turno de la vendedora (#7): abrió con $30.000; la #6 fue mixta.
const ventas: VentaTurno[] = [
  { id: 2, total: 3000, payment_method: "cash", sale_payments: [pago("CASH", 3000)] },
  { id: 4, total: 5525, payment_method: "cash", sale_payments: [pago("CASH", 5525)] },
  {
    id: 6,
    total: 8070,
    payment_method: "cash",
    sale_payments: [pago("CASH", 5000), pago("CARD", 3070)],
  },
  { id: 7, total: 2000, payment_method: "transfer", sale_payments: [pago("TRANSFER", 2000)] },
  // Compra propia de Mariana: por cobrar, no es plata en la caja.
  {
    id: 5,
    total: 1125,
    payment_method: "staff_credit",
    is_staff_purchase: true,
    sale_payments: [pago("STAFF_CREDIT", 1125)],
  },
  // Anulada desde OlivoWeb: no cuenta.
  { id: 9, total: 4000, payment_method: "cash", voided: true, sale_payments: [pago("CASH", 4000)] },
];

describe("resumenTurno", () => {
  it("cuenta cada pago en su método (mixto bien) y deja fuera lo por cobrar y lo anulado", () => {
    const r = resumenTurno({ inicio: 30000, ventas, movimientos: [] });
    expect(r.efectivo).toBe(13525);
    expect(r.tarjeta).toBe(3070);
    expect(r.transferencia).toBe(2000);
    expect(r.porCobrar).toBe(1125);
    expect(r.totalVentas).toBe(18595);
    expect(r.cantidadVentas).toBe(4);
    expect(r.anuladas).toEqual({ cantidad: 1, total: 4000 });
    expect(r.esperado).toBe(43525);
  });

  it("el esperado suma ingresos y resta egresos sólo en efectivo", () => {
    const r = resumenTurno({
      inicio: "30000.00",
      ventas,
      movimientos: [
        { amount: 15000, type: "OUT", method: "CASH" },
        { amount: 5000, type: "IN", method: "CASH" },
        { amount: 9000, type: "OUT", method: "TRANSFER" },
        { amount: "1000.00", type: "IN" },
      ],
    });
    expect(r.ingresos).toBe(6000);
    expect(r.egresos).toBe(15000);
    expect(r.esperado).toBe(43525 + 6000 - 15000);
  });

  it("una venta vieja sin sale_payments cuenta su total en el método principal", () => {
    const r = resumenTurno({
      inicio: 0,
      ventas: [
        { id: 1, total: 1000, payment_method: "Efectivo" },
        { id: 2, total: 700, payment_method: "debit" },
        { id: 3, total: 500, payment_method: null, is_staff_purchase: true },
      ],
      movimientos: [],
    });
    expect(r.efectivo).toBe(1000);
    expect(r.tarjeta).toBe(700);
    expect(r.porCobrar).toBe(500);
  });

  it("turno vacío: el esperado es el inicio", () => {
    const r = resumenTurno({ inicio: 20000, ventas: [], movimientos: [] });
    expect(r.esperado).toBe(20000);
    expect(r.totalVentas).toBe(0);
  });
});
