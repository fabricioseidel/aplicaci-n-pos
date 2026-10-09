import { describe, expect, it } from "vitest";
import { buildCierreLines, TICKET_COLS } from "./cierreLines";
import type { CierreResumen } from "@/lib/cierre/types";

const resumen = (): CierreResumen => ({
  shift: {
    id: "t1",
    branch_id: "b1",
    business_date: "2026-10-01",
    started_at: "2026-10-01T12:00:00Z",
    ended_at: "2026-10-01T23:30:00Z",
    starting_cash: 30000,
    actual_cash: 41500,
    status: "CLOSED",
    is_declared: true,
    notes: "Faltó sencillo\nDeja para mañana: $20.000",
    declared_totals: {
      CASH: { contado: 41500, inicial: 30000, ingresos: 0, egresos: 0, abonos: 0, ventas: 11500 },
      TRANSFER: { bruto: 0, abonos: 0, ventas: 0 },
      CARD: { bruto: 0, abonos: 0, ventas: 0 },
      fiados_otorgados: 0,
      abonos_recibidos: 0,
      total_ventas: 11500,
    },
    pos_totals: { CASH: 13525 },
  },
  branch: "Principal",
  denominations: [],
  transfers: [],
  vouchers: [],
  movements: [],
  account_entries: [],
  balances: [],
  compras_personal: [
    { id: 5, ts: "2026-10-01T15:00:00Z", total: 1125, seller_name: "MARIANA", staff_settled_at: null },
    { id: 7, ts: "2026-10-01T16:00:00Z", total: 900, seller_name: "INGRID", staff_settled_at: "2026-10-02T00:00:00Z" },
  ],
});

describe("buildCierreLines", () => {
  const lines = buildCierreLines(resumen());

  it("imprime cuánto queda para mañana y lo saca de las observaciones", () => {
    expect(lines.some((l) => l.startsWith("Deja para mañana") && l.endsWith("$ 20.000"))).toBe(true);
    const obs = lines.indexOf("OBSERVACIONES");
    expect(lines[obs + 1]).toBe("Faltó sencillo");
    expect(lines.filter((l) => l.includes("Deja para"))).toHaveLength(1);
  });

  it("imprime las compras del personal por cobrar (sin las ya liquidadas)", () => {
    const i = lines.indexOf("PERSONAL POR COBRAR");
    expect(i).toBeGreaterThan(-1);
    expect(lines[i + 1]).toMatch(/^ {2}MARIANA +\$ 1\.125$/);
    expect(lines.join("\n")).not.toContain("INGRID");
  });

  it("la hora va en HH:mm y ninguna línea se sale del ticket", () => {
    expect(lines.find((l) => l.startsWith("Turno"))).toMatch(/\d{2}:\d{2} a \d{2}:\d{2}$/);
    expect(lines.every((l) => l.length <= TICKET_COLS)).toBe(true);
  });
});
