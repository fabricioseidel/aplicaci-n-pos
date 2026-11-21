import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearFakeDb, clienteFake, type FakeDb } from "@/test/fakeSupabase";

const estado: { db: FakeDb } = { db: crearFakeDb() };

vi.mock("@/lib/api-auth", () => ({
  requireApiAdminOrSeller: async () => ({
    ok: true,
    role: "SELLER",
    userId: "u1",
    session: { user: { email: "caja@olivo.cl", name: "Caja" } },
  }),
}));
vi.mock("@/lib/supabase-server", () => ({
  get supabaseServer() {
    return clienteFake(estado.db);
  },
}));

import { GET, POST } from "./route";

const llamar = (body: unknown) =>
  POST(new Request("http://x/api/transfers", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  estado.db = crearFakeDb({
    branches: [
      { id: "bP", name: "Principal", is_default: true, is_active: true },
      { id: "bS", name: "Domicilio", is_default: false, is_active: true },
      { id: "bX", name: "Cerrada", is_default: false, is_active: false },
    ],
    products: [{ barcode: "coca", name: "Coca-Cola" }],
    audit_logs: [],
  });
  let n = 0;
  estado.db.rpcs.apply_transfer = () => ({ data: `TRF-${++n}`, error: null });
});

describe("/api/transfers", () => {
  it("traspasa de la sucursal al minimarket y deja quién lo hizo", async () => {
    const res = await llamar({
      items: [{ barcode: "coca", qty: 3 }],
      fromBranchId: "bS",
      toBranchId: "bP",
      atiende: "Mariana",
    });
    expect(res.status).toBe(200);
    expect(estado.db.llamadasRpc[0].args).toMatchObject({ p_from_branch_id: "bS", p_to_branch_id: "bP" });
    expect(estado.db.tablas.audit_logs[0]).toMatchObject({
      action: "inventory.transfer",
      entity_id: "TRF-1",
      details: {
        desde: { id: "bS", name: "Domicilio" },
        hacia: { id: "bP", name: "Principal" },
        unidades: 3,
        items: [{ barcode: "coca", qty: 3, name: "Coca-Cola" }],
      },
    });
    expect(String(estado.db.tablas.audit_logs[0].actor)).toContain("Mariana");
  });

  it("sin origen, sale del minimarket (lotes viejos en la cola)", async () => {
    await llamar({ items: [{ barcode: "coca", qty: 1 }], toBranchId: "bS" });
    expect(estado.db.llamadasRpc[0].args).toMatchObject({ p_from_branch_id: "bP", p_to_branch_id: "bS" });
  });

  it("rechaza la misma sede o una sede inactiva", async () => {
    expect((await llamar({ items: [{ barcode: "coca", qty: 1 }], fromBranchId: "bS", toBranchId: "bS" })).status).toBe(400);
    expect((await llamar({ items: [{ barcode: "coca", qty: 1 }], fromBranchId: "bP", toBranchId: "bX" })).status).toBe(400);
    expect(estado.db.llamadasRpc).toHaveLength(0);
  });

  it("el historial de una sede muestra entrantes y salientes", async () => {
    await llamar({ items: [{ barcode: "coca", qty: 2 }], fromBranchId: "bP", toBranchId: "bS" });
    await llamar({ items: [{ barcode: "coca", qty: 1 }], fromBranchId: "bS", toBranchId: "bP" });
    const res = await GET(new Request("http://x/api/transfers?branchId=bS"));
    const data = await res.json();
    expect(data.traspasos).toHaveLength(2);
  });
});
