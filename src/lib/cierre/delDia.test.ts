import { describe, expect, it } from "vitest";
import { sumarDelDia, type MovimientoAnotado } from "./delDia";

const mov = (id: string, kind: "CHARGE" | "PAYMENT", amount: number, method: string | null = null): MovimientoAnotado => ({
  id, account_id: "a1", kind, amount, method, note: null, name: "Don Pedro",
});

describe("sumarDelDia", () => {
  it("agrega fiados y abonos del día con su entry_id", () => {
    const r = sumarDelDia({ fiados: [], abonos: [] }, [mov("e1", "CHARGE", 3500), mov("e2", "PAYMENT", 2000, "TRANSFER")]);
    expect(r.agregados).toBe(2);
    expect(r.fiados[0]).toMatchObject({ entry_id: "e1", account_id: "a1", amount: 3500 });
    expect(r.abonos[0]).toMatchObject({ entry_id: "e2", method: "TRANSFER", amount: 2000 });
  });

  it("no duplica si ya estaban en el borrador", () => {
    const primera = sumarDelDia({ fiados: [], abonos: [] }, [mov("e1", "CHARGE", 3500)]);
    const segunda = sumarDelDia(primera, [mov("e1", "CHARGE", 3500)]);
    expect(segunda.agregados).toBe(0);
    expect(segunda.fiados).toHaveLength(1);
  });

  it("conserva lo que se anotó a mano en el cierre", () => {
    const r = sumarDelDia({ fiados: [{ name: "Rosa", amount: 1000 }], abonos: [] }, [mov("e1", "CHARGE", 3500)]);
    expect(r.fiados.map((f) => f.name)).toEqual(["Rosa", "Don Pedro"]);
  });
});
