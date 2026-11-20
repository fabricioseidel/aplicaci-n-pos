import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearFakeDb, clienteFake, type FakeDb } from "@/test/fakeSupabase";

const estado: { rol: "ADMIN" | "SELLER"; db: FakeDb } = { rol: "SELLER", db: crearFakeDb() };

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

import { POST } from "./route";

const llamar = (barcode: string, nuevo: string) =>
  POST(
    new Request("http://x", { method: "POST", body: JSON.stringify({ nuevo, atiende: "Mariana" }) }),
    { params: Promise.resolve({ barcode }) }
  );

beforeEach(() => {
  estado.rol = "SELLER";
  estado.db = crearFakeDb({
    products: [
      { barcode: "SINCOD-ATUN", name: "Atún", is_active: true },
      { barcode: "7802000016448", name: "Coca", is_active: true },
    ],
    audit_logs: [],
  });
  estado.db.rpcs.rename_product_barcode = (args) => {
    const p = estado.db.tablas.products.find((x) => x.barcode === args.p_old_barcode);
    if (p) p.barcode = args.p_new_barcode;
    return { data: null, error: null };
  };
});

describe("POST /api/products/:barcode/adoptar-codigo", () => {
  it("un vendedor le guarda el código escaneado a un producto con código genérico", async () => {
    const res = await llamar("SINCOD-ATUN", "7801234567890");
    expect(res.status).toBe(200);
    expect((await res.json()).barcode).toBe("7801234567890");
    expect(estado.db.tablas.products.some((p) => p.barcode === "7801234567890")).toBe(true);
    expect(estado.db.tablas.audit_logs[0]).toMatchObject({
      action: "products.rename_barcode",
      details: { antes: "SINCOD-ATUN", despues: "7801234567890" },
    });
  });

  it("un vendedor no puede reemplazar un código real", async () => {
    const res = await llamar("7802000016448", "7801234567890");
    expect(res.status).toBe(403);
    expect(estado.db.llamadasRpc).toHaveLength(0);
  });

  it("un admin sí puede", async () => {
    estado.rol = "ADMIN";
    const res = await llamar("7802000016448", "7801234567890");
    expect(res.status).toBe(200);
  });
});
