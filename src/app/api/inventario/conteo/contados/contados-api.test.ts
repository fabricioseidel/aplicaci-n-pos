import { describe, expect, it, vi } from "vitest";
import { crearFakeDb, clienteFake } from "@/test/fakeSupabase";

const db = crearFakeDb({
  stock_count_tags: [
    { session_id: "s1", product_barcode: "coca", qty: 3, counted_by: "Mariana", counted_at: "2026-11-20T19:00:00Z" },
    { session_id: "s1", product_barcode: "coca", qty: 5, counted_by: "Alfredo", counted_at: "2026-11-20T19:05:00Z" },
    { session_id: "s1", product_barcode: "coca", qty: 2, counted_by: "Fabricio", counted_at: "2026-11-20T19:10:00Z" },
    { session_id: "s1", product_barcode: "pan", qty: 1, counted_by: null, counted_at: "2026-11-20T19:01:00Z" },
    { session_id: "otra", product_barcode: "coca", qty: 99, counted_by: "X", counted_at: "2026-11-20T18:00:00Z" },
  ],
  products: [
    { barcode: "coca", name: "Coca-Cola" },
    { barcode: "pan", name: "Pan" },
  ],
});

vi.mock("@/lib/api-auth", () => ({
  requireApiAdminOrSeller: async () => ({ ok: true, role: "SELLER", userId: "u1", session: { user: { name: "Caja" } } }),
}));
vi.mock("@/lib/supabase-server", () => ({
  get supabaseServer() {
    return clienteFake(db);
  },
}));

import { GET } from "./route";

describe("GET /api/inventario/conteo/contados", () => {
  it("suma lo que contó cada persona: 3 + 5 + 2 = 10", async () => {
    const res = await GET(new Request("http://x/api/inventario/conteo/contados?sessionId=s1"));
    const data = await res.json();
    const coca = data.productos.find((p: { barcode: string }) => p.barcode === "coca");
    expect(coca).toMatchObject({ name: "Coca-Cola", total: 10, marcas: 3 });
    expect(coca.porPersona).toEqual(
      expect.arrayContaining([
        { por: "Mariana", qty: 3 },
        { por: "Alfredo", qty: 5 },
        { por: "Fabricio", qty: 2 },
      ])
    );
    expect(data.productos.find((p: { barcode: string }) => p.barcode === "pan").porPersona).toEqual([
      { por: "Sin nombre", qty: 1 },
    ]);
  });
});
