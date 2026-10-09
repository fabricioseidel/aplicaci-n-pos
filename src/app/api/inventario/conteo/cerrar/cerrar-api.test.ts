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
