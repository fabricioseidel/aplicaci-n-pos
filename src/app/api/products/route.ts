import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse, successResponse } from "@/lib/api-response";
import { mapSupaToUI, PRODUCT_COLUMNS } from "@/services/products";
import { applyCount, type CountItem } from "@/server/stock-count.service";
import type { SupaProduct } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/products — catálogo completo para el POS.
 *
 * A diferencia del catálogo público de la tienda, acá NO se filtra por
 * "producto visible" (foto + categoría + precio): en el mostrador hay que
 * poder cobrar un producto aunque le falte la foto. Sólo se excluyen los
 * explícitamente inactivos.
 *
 * El service worker cachea esta respuesta (NetworkFirst) para que el catálogo
 * siga navegable sin conexión.
 */
export async function GET() {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await supabaseServer
      .from("products")
      .select(PRODUCT_COLUMNS)
      // `is_active IS NULL` cuenta como activo (registros antiguos). Un
      // `.neq("is_active", false)` los dejaría fuera, porque en SQL
      // `NULL != false` no es true.
      .or("is_active.is.null,is_active.eq.true")
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (error) throw error;

    const items = ((data ?? []) as unknown as SupaProduct[]).map(mapSupaToUI);
    return NextResponse.json({ items });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Upsert con tolerancia a columnas ausentes: si PostgREST responde que una
 * columna no existe en el schema cache, se quita del payload y se reintenta.
 * Evita que un despliegue de la base fuera de fase tumbe la creación de
 * productos desde el mostrador.
 */
async function upsertProductsWithColumnFallback(payloadsInput: Record<string, unknown>[]) {
  let payloads = payloadsInput.map((p) => ({ ...p }));
  let lastError: unknown;

  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await supabaseServer
      .from("products")
      .upsert(payloads, { onConflict: "barcode" });
    if (!error) return;

    lastError = error;

    if (error.code === "PGRST204" && typeof error.message === "string") {
      const match = error.message.match(/Could not find the '([^']+)' column of 'products'/);
      const missingColumn = match?.[1];
      if (missingColumn) {
        let changed = false;
        payloads = payloads.map((p) => {
          if (Object.prototype.hasOwnProperty.call(p, missingColumn)) {
            const next = { ...p };
            delete next[missingColumn];
            changed = true;
            return next;
          }
          return p;
        });
        if (changed) continue;
      }
    }

    throw error;
  }

  throw lastError;
}

/**
 * POST /api/products — crea o actualiza por `barcode`.
 *
 * `stock` recibe un trato aparte: NO se escribe en `products`. La columna es
 * derivada de `branch_stock` (un trigger la recalcula en cada escritura), así
 * que hasta ahora el número que se escribía acá se descartaba en silencio —
 * el mostrador editaba el stock, veía el toast de éxito y el valor volvía
 * solo. Antes de que existiera ese trigger era peor: la edición de un
 * producto pisaba el stock real con el que el navegador tenía cacheado y
 * revertía la recepción que otra persona acababa de registrar.
 *
 * Ahora la cantidad que llega se aplica como un ajuste absoluto sobre la
 * sucursal (`apply_stock_absolute`, motivo `MANUAL_ADJUSTMENT`): mueve el
 * stock de verdad y queda el rastro en `inventory_movements`.
 */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const text = await req.text();
    if (!text.trim()) return errorResponse(new Error("Empty request body"), 400);

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return errorResponse(new Error("Invalid JSON body"), 400);
    }

    const asRecord = body as { items?: unknown };
    const items = (Array.isArray(asRecord?.items) ? asRecord.items : [body]) as Record<
      string,
      unknown
    >[];

    if (items.length === 0) return errorResponse(new Error("Missing items"), 400);

    for (const item of items) {
      if (!item?.barcode) return errorResponse(new Error("Missing barcode"), 400);
    }

    // El stock sale del payload y se aplica aparte, sobre branch_stock.
    const stockObjetivo: CountItem[] = [];
    const payloads = items.map((item) => {
      const { stock, ...resto } = item;
      const qty = Number(stock);
      if (stock !== undefined && stock !== null && Number.isFinite(qty) && qty >= 0) {
        stockObjetivo.push({ barcode: String(item.barcode), qty });
      }
      return resto;
    });

    // Los productos primero: `apply_stock_absolute` ignora los códigos que no
    // existen todavía, así que un alta con stock necesita este orden.
    await upsertProductsWithColumnFallback(payloads);

    let stockAplicado = 0;
    let stockError: string | null = null;

    if (stockObjetivo.length > 0) {
      const branchId =
        typeof (body as { branchId?: unknown }).branchId === "string"
          ? ((body as { branchId?: string }).branchId as string)
          : null;

      const res = await applyCount({
        items: stockObjetivo,
        branchId,
        reason: "MANUAL_ADJUSTMENT",
        countedBy: auth.session.user?.name ?? auth.session.user?.email ?? auth.userId ?? null,
      });

      if (res.ok) stockAplicado = res.ajustados;
      // El producto ya quedó guardado; que falle el ajuste de stock no puede
      // hacer parecer que no se guardó nada. Se informa aparte.
      else stockError = res.error;
    }

    return successResponse({
      success: true,
      count: items.length,
      stockAjustado: stockAplicado,
      ...(stockError ? { stockError } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
