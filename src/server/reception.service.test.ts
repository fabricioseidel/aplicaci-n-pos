import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearFakeDb, clienteFake, type FakeDb } from "@/test/fakeSupabase";

const estado: { db: FakeDb } = { db: crearFakeDb() };
vi.mock("@/lib/supabase-server", () => ({
  get supabaseServer() {
    return clienteFake(estado.db);
  },
}));

import { createReception } from "./reception.service";

beforeEach(() => {
  estado.db = crearFakeDb({
    products: [
      { barcode: "111", name: "Harina PAN", is_active: false },
      { barcode: "222", name: "Arroz", is_active: true },
      { barcode: "333", name: "Otro inactivo", is_active: false },
    ],
  });
  estado.db.rpcs.apply_reception = () => ({ data: 2, error: null });
});

describe("createReception", () => {
  it("recibir un producto inactivo lo reactiva; los demás no cambian", async () => {
    const r = await createReception({ items: [{ barcode: "111", qty: 3 }, { barcode: "222", qty: 1 }] });
    expect(r).toEqual({ ok: true, count: 2 });
    const por = Object.fromEntries(estado.db.tablas.products.map((p) => [p.barcode, p.is_active]));
    expect(por).toEqual({ "111": true, "222": true, "333": false });
  });

  it("si el RPC falla no reactiva nada", async () => {
    estado.db.rpcs.apply_reception = () => ({ data: null, error: { message: "boom" } });
    const r = await createReception({ items: [{ barcode: "111", qty: 3 }] });
    expect(r).toEqual({ ok: false, error: "boom" });
    expect(estado.db.tablas.products[0].is_active).toBe(false);
  });
});
