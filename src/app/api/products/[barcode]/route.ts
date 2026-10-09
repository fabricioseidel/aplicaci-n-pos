import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { mapSupaToUI } from "@/services/products";
import { validarCambios, type Cambios } from "@/lib/products/edicion";
import {
  actorDe,
  codigosConCostoDeProveedor,
  conColumnasDeProducto,
  filaParaRol,
  registrarCambiosDePrecio,
  stockEnSucursal,
  sucursalOPorDefecto,
  type CambioDePrecio,
} from "@/server/productos.service";
import type { SupaProduct } from "@/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ barcode: string }> };

async function leerFila(barcode: string) {
  const { data, error } = await conColumnasDeProducto((cols) =>
    supabaseServer.from("products").select(cols).eq("barcode", barcode).maybeSingle()
  );
  if (error) throw error;
  return (data as unknown as SupaProduct & Record<string, unknown>) ?? null;
}

/**
 * GET /api/products/:barcode?branchId= — la ficha fresca, incluidos los
 * desactivados. La ficha se abre siempre con esto y no con el catálogo
 * cacheado: el catálogo redondea el precio y puede tener horas.
 *
 * `fila` va sin redondear: es la base del `expected` del PATCH.
 */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { barcode } = await ctx.params;
    const fila = await leerFila(decodeURIComponent(barcode));
    if (!fila) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    const branchParam = new URL(req.url).searchParams.get("branchId");
    const branchId = await sucursalOPorDefecto(branchParam);
    const [conProveedor, stockSucursal] = await Promise.all([
      codigosConCostoDeProveedor([fila.barcode]),
      branchId ? stockEnSucursal(fila.barcode, branchId) : Promise.resolve(Number(fila.stock ?? 0)),
    ]);

    const visible = filaParaRol(fila, auth.role);
    return NextResponse.json({
      fila: visible,
      producto: mapSupaToUI(visible as SupaProduct),
      costoDelProveedor: conProveedor.has(fila.barcode),
      stockSucursal,
      branchId,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * PATCH /api/products/:barcode — guarda SÓLO los campos que cambiaron.
 * Body: { changes, expected?, atiende? }
 *
 * - `changes`: lista blanca de `validarCambios`. `stock` se rechaza con 400:
 *   el stock se mueve con "Ajustar stock" (`/stock`), nunca desde la ficha.
 * - `expected`: el valor original de cada campo cambiado. Si otra persona
 *   cambió ese mismo campo mientras se editaba, no se pisa: 409 con la fila
 *   actual. No se usa `updated_at` porque cada venta lo toca (trigger del
 *   stock) y daría conflictos falsos todo el día.
 * - El costo (`purchase_price`) sólo lo cambia un ADMIN, y sólo en productos
 *   sin proveedor con costo (en esos lo fija el proveedor; ver
 *   `products_purchase_price_derivado`).
 * - Cada cambio de precio u oferta queda en `audit_logs` con quién atendía.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { barcode: raw } = await ctx.params;
    const barcode = decodeURIComponent(raw);
    const body = (await req.json().catch(() => null)) as {
      changes?: unknown;
      expected?: Record<string, unknown>;
      atiende?: unknown;
    } | null;

    const valid = validarCambios(body?.changes);
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
    const changes: Cambios = valid.changes;

    if ("purchase_price" in changes) {
      if (auth.role !== "ADMIN") {
        return NextResponse.json({ error: "Sólo un administrador cambia el costo" }, { status: 403 });
      }
      const conProveedor = await codigosConCostoDeProveedor([barcode]);
      if (conProveedor.has(barcode)) {
        return NextResponse.json(
          { error: "El costo de este producto lo fija su proveedor: se cambia en OlivoWeb → Precios" },
          { status: 409 }
        );
      }
    }

    const antes = await leerFila(barcode);
    if (!antes) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    const expected = body?.expected && typeof body.expected === "object" ? body.expected : {};
    const { data, error } = await conColumnasDeProducto((cols) => {
      let q = supabaseServer.from("products").update(changes).eq("barcode", barcode);
      for (const k of Object.keys(changes)) {
        if (!(k in expected)) continue;
        const v = expected[k];
        q = v === null || v === undefined ? q.is(k, null) : q.eq(k, v as string | number | boolean);
      }
      return q.select(cols);
    });
    if (error) throw error;

    if (!data || data.length === 0) {
      const actual = await leerFila(barcode);
      if (!actual) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
      const visible = filaParaRol(actual, auth.role);
      const nombres: Record<string, string> = {
        sale_price: "el precio",
        offer_price: "la oferta",
        purchase_price: "el costo",
        name: "el nombre",
      };
      const quien = Object.keys(changes)
        .filter((k) => k in expected)
        .find((k) => String(expected[k] ?? "") !== String((actual as Record<string, unknown>)[k] ?? ""));
      return NextResponse.json(
        {
          error: `Alguien cambió ${quien ? nombres[quien] ?? quien : "este producto"} mientras editabas`,
          conflicto: true,
          fila: visible,
          producto: mapSupaToUI(visible as SupaProduct),
        },
        { status: 409 }
      );
    }

    const despues = data[0] as unknown as SupaProduct & Record<string, unknown>;

    const cambiosDePrecio: CambioDePrecio[] = (["sale_price", "offer_price"] as const)
      .filter((k) => k in changes)
      .map((k) => ({
        barcode,
        nombre: despues.name,
        campo: k,
        antes: antes[k] === null || antes[k] === undefined ? null : Number(antes[k]),
        despues: despues[k] === null || despues[k] === undefined ? null : Number(despues[k]),
      }))
      .filter((c) => c.antes !== c.despues);
    await registrarCambiosDePrecio(actorDe(auth.session, body?.atiende), cambiosDePrecio);

    // El trigger reemplaza el costo si apareció un proveedor entretanto: se
    // avisa en vez de mostrar como guardado un número que no quedó.
    const avisos: string[] = [];
    if (
      "purchase_price" in changes &&
      Math.abs(Number(despues.purchase_price ?? 0) - Number(changes.purchase_price ?? 0)) > 0.005
    ) {
      avisos.push("El costo quedó con el del proveedor");
    }

    const visible = filaParaRol(despues, auth.role);
    return NextResponse.json({
      ok: true,
      fila: visible,
      producto: mapSupaToUI(visible as SupaProduct),
      ...(avisos.length ? { aviso: avisos.join(". ") } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
