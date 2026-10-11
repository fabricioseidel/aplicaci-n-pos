import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearFakeDb, clienteFake, type FakeDb } from "@/test/fakeSupabase";

const estado: { db: FakeDb } = { db: crearFakeDb() };

vi.mock("@/lib/api-auth", () => ({
  requireApiAdminOrSeller: async () => ({ ok: true, role: "SELLER", userId: "u1", session: { user: {} } }),
}));
vi.mock("@/lib/supabase-server", () => ({
  get supabaseServer() {
    return clienteFake(estado.db);
  },
}));

beforeEach(() => {
  estado.db = crearFakeDb({
    products: [
      { id: "1", barcode: "111", name: "HARINA DE MAÍZ PAN BLANCA", is_active: false, sale_price: 1500, stock: 3 },
      { id: "2", barcode: "222", name: "Harina de trigo", is_active: true, sale_price: 1200, stock: 5 },
      { id: "3", barcode: "333", name: "Arroz", is_active: true, sale_price: 900, stock: 8 },
    ],
  });
});

async function buscar(qs: string) {
  const { GET } = await import("./route");
  const res = await GET(new Request(`http://x/api/inventario/buscar?${qs}`) as never);
  return (await res.json()) as { productos?: Array<{ id: string }>; producto?: { id: string } | null };
}

describe("GET /api/inventario/buscar", () => {
  it("encuentra un inactivo aunque otros activos coincidan con parte del texto", async () => {
    const { productos } = await buscar("q=harina");
    expect(productos?.map((p) => p.id).sort()).toEqual(["111", "222"]);
  });

  it("busca por palabras sueltas, en cualquier orden", async () => {
    expect((await buscar("q=harina%20pan")).productos?.map((p) => p.id)).toEqual(["111"]);
    expect((await buscar("q=pan%20harina")).productos?.map((p) => p.id)).toEqual(["111"]);
  });

  it("con inactivos=1 sólo trae inactivos, aunque haya más de 25 activos que coincidan", async () => {
    for (let i = 0; i < 30; i++) {
      estado.db.tablas.products.push({ id: `a${i}`, barcode: `9${i}`, name: `Harina de trigo ${i}`, is_active: true });
    }
    const { productos } = await buscar("q=harina&inactivos=1");
    expect(productos?.map((p) => p.id)).toEqual(["111"]);
  });

  it("con menos de 2 letras no busca", async () => {
    expect((await buscar("q=h")).productos).toEqual([]);
  });

  it("por código exacto trae el producto inactivo", async () => {
    expect((await buscar("barcode=111")).producto?.id).toBe("111");
    expect((await buscar("barcode=999")).producto).toBeNull();
  });
});
