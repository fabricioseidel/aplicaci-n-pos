import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearFakeDb, clienteFake, type FakeDb } from "@/test/fakeSupabase";

const estado: { db: FakeDb } = { db: crearFakeDb() };
vi.mock("@/lib/supabase-server", () => ({
  get supabaseServer() {
    return clienteFake(estado.db);
  },
}));

import { anularVenta } from "./anulacion.service";

beforeEach(() => {
  estado.db = crearFakeDb({
    account_entries: [
      { id: "a", kind: "CHARGE", note: "Venta #7 · fiado · Anotó: Ingrid" },
      { id: "b", kind: "CHARGE", note: "Venta #77 · fiado" },
      { id: "c", kind: "PAYMENT", note: "Venta #7 · abono raro" },
      { id: "d", kind: "CHARGE", note: "ajuste manual" },
    ],
  });
  estado.db.rpcs.anular_venta = () => ({ data: null, error: null });
});

describe("anularVenta", () => {
  it("borra sólo el cargo de fiado de esa venta", async () => {
    expect(await anularVenta(7, "error", "admin")).toBe(true);
    expect(estado.db.tablas.account_entries.map((e) => e.id)).toEqual(["b", "c", "d"]);
  });

  it("si el RPC falla no toca los fiados", async () => {
    estado.db.rpcs.anular_venta = () => ({ data: null, error: { message: "boom" } });
    await expect(anularVenta(7, "x", "admin")).rejects.toThrow("boom");
    expect(estado.db.tablas.account_entries).toHaveLength(4);
  });
});
