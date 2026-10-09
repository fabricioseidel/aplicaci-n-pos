import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearFakeDb, clienteFake, type FakeDb } from "@/test/fakeSupabase";

const estado: { rol: "ADMIN" | "SELLER"; db: FakeDb } = { rol: "ADMIN", db: crearFakeDb() };

vi.mock("@/lib/api-auth", () => ({
  requireApiAdminOrSeller: async () => ({
    ok: true,
    role: estado.rol,
    userId: "u1",
    session: { user: { email: "caja@olivo.cl", name: "Caja" } },
  }),
}));
vi.mock("@/lib/supabase-server", () => ({
  get supabaseServer() {
    return clienteFake(estado.db);
  },
}));

beforeEach(() => {
  estado.rol = "ADMIN";
  estado.db = crearFakeDb({
    products: [
      { barcode: "coca", sale_price: 1000, purchase_price: 571.43, category: "Bebidas", margin_override: null },
      { barcode: "pepsi", sale_price: 990, purchase_price: 500, category: "Bebidas", margin_override: 0.2 },
      { barcode: "pan", sale_price: 0, purchase_price: 0, category: null, margin_override: null },
    ],
    product_suppliers: [{ product_id: "pepsi", unit_cost: 500 }],
    category_margins: [
      { category: "__default__", margin: 0.35, rounding: "decena" },
      { category: "Bebidas", margin: 0.3, rounding: "terminacion90" },
    ],
  });
});

async function get(barcodes: string) {
  const { GET } = await import("./route");
  const res = await GET(new Request(`http://x/api/inventario/recepcion?barcodes=${barcodes}`));
  return { status: res.status, body: (await res.json()) as { items: Array<Record<string, unknown>>; verCosto: boolean } };
}

describe("GET /api/inventario/recepcion", () => {
  it("al ADMIN le da precio, costo sin redondear, proveedor y margen", async () => {
    const { status, body } = await get("coca,pepsi,pan");
    expect(status).toBe(200);
    expect(body.verCosto).toBe(true);
    const por = Object.fromEntries(body.items.map((i) => [i.barcode, i]));
    expect(por.coca).toMatchObject({
      precio: 1000,
      costoNeto: 571.43,
      costoDelProveedor: false,
      regla: { margen: 0.3, redondeo: "terminacion90", origen: "categoria" },
    });
    expect(por.pepsi).toMatchObject({ costoDelProveedor: true, regla: { margen: 0.2, origen: "producto" } });
    expect(por.pan).toMatchObject({ costoNeto: null, regla: { margen: 0.35, origen: "general" } });
  });

  it("a una vendedora no le manda el costo", async () => {
    estado.rol = "SELLER";
    const { body } = await get("coca");
    expect(body.verCosto).toBe(false);
    expect(body.items[0].costoNeto).toBeNull();
    expect(body.items[0].precio).toBe(1000);
  });

  it("sin códigos responde vacío", async () => {
    const { body } = await get("");
    expect(body.items).toEqual([]);
  });
});
