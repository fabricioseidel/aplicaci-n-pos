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

const PRINCIPAL = "b-principal";

function sembrar() {
  estado.db = crearFakeDb({
    products: [
      {
        barcode: "coca", name: "Coca lata", sale_price: 1000, offer_price: null, purchase_price: 571.43,
        min_stock: 5, optimum_stock: 20, stock: 17, is_active: true, category: "Bebidas",
      },
      {
        barcode: "pepsi", name: "Pepsi lata", sale_price: 1000, offer_price: 900, purchase_price: 500,
        min_stock: 5, optimum_stock: 20, stock: 10, is_active: false,
      },
    ],
    product_suppliers: [{ product_id: "pepsi", unit_cost: 500 }],
    branches: [{ id: PRINCIPAL, is_default: true, is_active: true }],
    branch_stock: [{ branch_id: PRINCIPAL, product_barcode: "coca", stock: 17 }],
    audit_logs: [],
  });
  estado.db.rpcs.apply_stock_absolute = (args) => {
    const items = args.p_items as Array<{ barcode: string; qty: number }>;
    for (const it of items) {
      const fila = estado.db.tablas.branch_stock.find((b) => b.product_barcode === it.barcode);
      if (fila) fila.stock = it.qty;
    }
    return { data: { ok: true, aplicados: items.length, ajustados: items.length }, error: null };
  };
}

const ctx = (barcode: string) => ({ params: Promise.resolve({ barcode }) });
const patch = (barcode: string, body: unknown) =>
  new Request(`http://x/api/products/${barcode}`, { method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => {
  estado.rol = "ADMIN";
  sembrar();
});

describe("PATCH /api/products/:barcode", () => {
  it("cambia sólo el precio: costo, mínimos y stock quedan intactos, y queda en audit_logs", async () => {
    const { PATCH } = await import("./[barcode]/route");
    const res = await PATCH(
      patch("coca", { changes: { sale_price: 1100 }, expected: { sale_price: 1000 }, atiende: "Mariana" }),
      ctx("coca")
    );
    expect(res.status).toBe(200);
    const coca = estado.db.tablas.products[0];
    expect(coca).toMatchObject({ sale_price: 1100, purchase_price: 571.43, min_stock: 5, optimum_stock: 20, stock: 17 });
    const log = estado.db.tablas.audit_logs[0] as { actor: string; details: { cambiosDePrecio: unknown[] } };
    expect(log.actor).toMatch(/^Mariana/);
    expect(log.details.cambiosDePrecio).toEqual([
      { barcode: "coca", nombre: "Coca lata", campo: "sale_price", antes: 1000, despues: 1100 },
    ]);
  });

  it("rechaza el stock con 400", async () => {
    const { PATCH } = await import("./[barcode]/route");
    const res = await PATCH(patch("coca", { changes: { stock: 3 } }), ctx("coca"));
    expect(res.status).toBe(400);
    expect(estado.db.tablas.products[0].stock).toBe(17);
  });

  it("si otra persona cambió el precio entretanto responde 409 y no pisa", async () => {
    const { PATCH } = await import("./[barcode]/route");
    estado.db.tablas.products[0].sale_price = 1200; // lo cambió alguien más
    const res = await PATCH(patch("coca", { changes: { sale_price: 1100 }, expected: { sale_price: 1000 } }), ctx("coca"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflicto).toBe(true);
    expect(body.fila.sale_price).toBe(1200);
    expect(estado.db.tablas.products[0].sale_price).toBe(1200);
  });

  it("un SELLER no cambia el costo", async () => {
    estado.rol = "SELLER";
    const { PATCH } = await import("./[barcode]/route");
    const res = await PATCH(patch("coca", { changes: { purchase_price: 600 } }), ctx("coca"));
    expect(res.status).toBe(403);
  });

  it("el costo de un producto con proveedor no se cambia desde el POS", async () => {
    const { PATCH } = await import("./[barcode]/route");
    const res = await PATCH(patch("pepsi", { changes: { purchase_price: 300 } }), ctx("pepsi"));
    expect(res.status).toBe(409);
  });

  it("reactivar un desactivado funciona", async () => {
    const { PATCH } = await import("./[barcode]/route");
    const res = await PATCH(patch("pepsi", { changes: { is_active: true }, expected: { is_active: false } }), ctx("pepsi"));
    expect(res.status).toBe(200);
    expect(estado.db.tablas.products[1].is_active).toBe(true);
  });
});

describe("GET /api/products/:barcode", () => {
  it("al SELLER no le llega el costo; al ADMIN sí, con el aviso de proveedor", async () => {
    const { GET } = await import("./[barcode]/route");
    estado.rol = "SELLER";
    let body = await (await GET(new Request("http://x/api/products/pepsi"), ctx("pepsi"))).json();
    expect(body.fila).not.toHaveProperty("purchase_price");
    estado.rol = "ADMIN";
    body = await (await GET(new Request("http://x/api/products/pepsi"), ctx("pepsi"))).json();
    expect(body.fila.purchase_price).toBe(500);
    expect(body.costoDelProveedor).toBe(true);
  });
});

describe("POST /api/products/:barcode/stock", () => {
  const post = (body: unknown) =>
    new Request("http://x/api/products/coca/stock", { method: "POST", body: JSON.stringify(body) });

  it("ajusta con motivo y queda registrado", async () => {
    const { POST } = await import("./[barcode]/stock/route");
    const res = await POST(post({ stock: 12, stockVisto: 17, motivo: "Merma", opId: "op-12345678" }), ctx("coca"));
    expect(res.status).toBe(200);
    expect(estado.db.tablas.branch_stock[0].stock).toBe(12);
    expect(estado.db.llamadasRpc[0].args).toMatchObject({ p_op_id: "op-12345678", p_reason: "MANUAL_ADJUSTMENT" });
    expect((estado.db.tablas.audit_logs[0] as { details: { motivo: string } }).details.motivo).toBe("Merma");
  });

  it("si alguien vendió mientras ajustaba, 409 sin tocar el stock", async () => {
    const { POST } = await import("./[barcode]/stock/route");
    estado.db.tablas.branch_stock[0].stock = 15;
    const res = await POST(post({ stock: 12, stockVisto: 17, motivo: "Merma", opId: "op-12345678" }), ctx("coca"));
    expect(res.status).toBe(409);
    expect(estado.db.tablas.branch_stock[0].stock).toBe(15);
    expect(estado.db.llamadasRpc).toHaveLength(0);
  });

  it("un reintento del mismo ajuste es ok y no se aplica dos veces", async () => {
    const { POST } = await import("./[barcode]/stock/route");
    estado.db.tablas.branch_stock[0].stock = 12;
    const res = await POST(post({ stock: 12, stockVisto: 17, motivo: "Merma", opId: "op-12345678" }), ctx("coca"));
    expect(res.status).toBe(200);
    expect(estado.db.llamadasRpc).toHaveLength(0);
  });

  it("sin motivo no se ajusta", async () => {
    const { POST } = await import("./[barcode]/stock/route");
    const res = await POST(post({ stock: 12, stockVisto: 17, opId: "op-12345678" }), ctx("coca"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/products", () => {
  it("?estado=inactivos trae sólo los desactivados, y el catálogo normal no los trae", async () => {
    const { GET } = await import("./route");
    const inact = await (await GET(new Request("http://x/api/products?estado=inactivos"))).json();
    expect(inact.items.map((p: { id: string }) => p.id)).toEqual(["pepsi"]);
    const normal = await (await GET(new Request("http://x/api/products"))).json();
    expect(normal.items.map((p: { id: string }) => p.id)).toEqual(["coca"]);
  });

  it("un alta con un código que ya existe responde 409 y no lo pisa", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/products", {
        method: "POST",
        body: JSON.stringify({ barcode: "pepsi", name: "Otra cosa", sale_price: 10, crear: true, v: 2 }),
      })
    );
    expect(res.status).toBe(409);
    expect(estado.db.tablas.products[1].name).toBe("Pepsi lata");
  });
});
