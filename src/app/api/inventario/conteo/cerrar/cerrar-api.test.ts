import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearFakeDb, clienteFake, type FakeDb } from "@/test/fakeSupabase";

const estado: { rol: "ADMIN" | "SELLER"; db: FakeDb; pendientes: number } = {
  rol: "ADMIN",
  db: crearFakeDb(),
  pendientes: 57,
};

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
  estado.pendientes = 57;
  estado.db = crearFakeDb();
  estado.db.rpcs.stock_count_progress = () => ({
    data: { ok: true, sessionId: "s1", status: "OPEN", pendientes: estado.pendientes },
    error: null,
  });
  estado.db.rpcs.close_stock_count = () => ({
    data: { ok: true, applyMode: "ON_CLOSE", contados: 3, aplicados: 3, puestosEnCero: 0, desactivados: 0 },
    error: null,
  });
});

async function cerrar(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST(
    new Request("http://x/api/inventario/conteo/cerrar", { method: "POST", body: JSON.stringify(body) })
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const llamadaCierre = () => estado.db.llamadasRpc.find((l) => l.fn === "close_stock_count")?.args;

describe("POST /api/inventario/conteo/cerrar", () => {
  it("una vendedora cierra «solo lo escaneado» sin poner nada en 0", async () => {
    estado.rol = "SELLER";
    const r = await cerrar({ sessionId: "s1", modo: "escaneado" });
    expect(r.status).toBe(200);
    expect(llamadaCierre()).toMatchObject({ p_zero_uncounted: false, p_deactivate_uncounted: false });
  });

  it("una vendedora NO puede poner en 0 lo no contado", async () => {
    estado.rol = "SELLER";
    const r = await cerrar({ sessionId: "s1", modo: "todo", esperadoPendientes: 57 });
    expect(r.status).toBe(403);
    expect(llamadaCierre()).toBeUndefined();
  });

  it("el formato anterior sin modo se trata como «todo» (solo ADMIN)", async () => {
    estado.rol = "SELLER";
    expect((await cerrar({ sessionId: "s1" })).status).toBe(403);
  });

  it("«todo» exige el número confirmado", async () => {
    const r = await cerrar({ sessionId: "s1", modo: "todo" });
    expect(r.status).toBe(400);
    expect(llamadaCierre()).toBeUndefined();
  });

  it("«todo» aborta si el número cambió mientras se confirmaba", async () => {
    estado.pendientes = 55;
    const r = await cerrar({ sessionId: "s1", modo: "todo", esperadoPendientes: 57 });
    expect(r.status).toBe(409);
    expect(r.body.actual).toBe(55);
    expect(llamadaCierre()).toBeUndefined();
  });

  it("un ADMIN con el número correcto cierra poniendo en 0 lo no contado", async () => {
    const r = await cerrar({ sessionId: "s1", modo: "todo", esperadoPendientes: 57 });
    expect(r.status).toBe(200);
    expect(llamadaCierre()).toMatchObject({ p_zero_uncounted: true, p_deactivate_uncounted: true });
  });

  it("modo desconocido es 400", async () => {
    expect((await cerrar({ sessionId: "s1", modo: "borrar" })).status).toBe(400);
  });
});

describe("POST /api/inventario/conteo/cerrar · sucursal", () => {
  beforeEach(() => {
    estado.db.tablas.branches = [
      { id: "bP", name: "Principal", is_default: true, is_active: true },
      { id: "bS", name: "Domicilio", is_default: false, is_active: true },
    ];
    estado.db.tablas.stock_count_sessions = [{ id: "s1", branch_id: "bS", status: "OPEN" }];
    estado.db.tablas.stock_count_entries = [
      { session_id: "s1", product_barcode: "coca" },
      { session_id: "s1", product_barcode: "pan" },
    ];
    estado.db.tablas.products = [
      { barcode: "coca", is_active: true },
      { barcode: "pan", is_active: false },
      { barcode: "agua", is_active: true },
    ];
    estado.db.tablas.branch_stock = [
      { branch_id: "bS", product_barcode: "coca", stock: 0 },
      { branch_id: "bS", product_barcode: "pan", stock: 4 },
      { branch_id: "bP", product_barcode: "agua", stock: 9 },
    ];
    // Lo que hace la base hoy: activa/desactiva cada contado según el stock
    // de la sede del conteo, y en conteo total apaga lo no contado.
    estado.db.rpcs.close_stock_count = (args) => {
      const p = estado.db.tablas.products;
      p.find((x) => x.barcode === "coca")!.is_active = false;
      p.find((x) => x.barcode === "pan")!.is_active = true;
      if (args.p_deactivate_uncounted) p.find((x) => x.barcode === "agua")!.is_active = false;
      return {
        data: { ok: true, applyMode: "ON_CLOSE", contados: 2, aplicados: 2, puestosEnCero: 0, desactivados: 1 },
        error: null,
      };
    };
  });

  it("un conteo total de la sucursal no saca productos del catálogo de todas las sedes", async () => {
    const r = await cerrar({ sessionId: "s1", modo: "todo", esperadoPendientes: 0 });
    expect(r.status).toBe(200);
    expect(llamadaCierre()).toMatchObject({ p_zero_uncounted: true, p_deactivate_uncounted: false });
    const activo = (c: string) => estado.db.tablas.products.find((x) => x.barcode === c)!.is_active;
    expect(activo("agua")).toBe(true); // no se contó en la sucursal, pero el minimarket lo tiene
    expect(activo("coca")).toBe(true); // contado en 0 en la sucursal: sigue en el catálogo
    expect(activo("pan")).toBe(true); // la sucursal lo tiene: se puede vender allá
    expect(r.body.desactivados).toBe(0);
  });
});
