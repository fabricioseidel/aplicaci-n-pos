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

/** Campos que el formulario viejo mandaba en null/0 aunque no los mostrara. */
const NO_PISAR_SI_VACIO = ["min_stock", "optimum_stock", "description", "measurement_value"] as const;

/**
 * Campos del formulario que un cliente viejo (sin `v: 2`) mandaba vacíos al
 * crear sobre un código existente: en un producto que ya existe no se pisan.
 */
const NO_PISAR_SI_VACIO_LEGACY = ["category", "image_url", "offer_price"] as const;

const vacio = (v: unknown) => v === null || v === undefined || v === "";

type Existente = { barcode: string; name: string | null; is_active: boolean | null; stock: number | null };

/**
 * POST /api/products — crea o actualiza por `barcode`.
 *
 * Guardar un producto sólo escribe lo que el formulario realmente maneja.
 * Antes cada guardado mandaba también `purchase_price: 0`, `min_stock: null`,
 * etc., y borraba el costo y los mínimos de todo producto editado desde el
 * mostrador; además el stock que mostraba la pantalla se aplicaba como ajuste
 * absoluto y revertía las ventas hechas mientras la ficha estaba abierta.
 *
 * Reglas:
 * - `purchase_price` sólo se escribe si es > 0; los campos de
 *   `NO_PISAR_SI_VACIO` nunca se escriben vacíos.
 * - `stock` no va a `products` (es derivado de `branch_stock`). En un alta se
 *   aplica como stock inicial. En un producto existente sólo se aplica si el
 *   cliente manda `stockAnterior` (lo que vio al abrir la ficha), lo cambió, y
 *   el stock real sigue siendo ese; si alguien vendió o recibió entretanto, no
 *   se aplica y se avisa. Un cliente viejo (sin `stockAnterior`) no mueve stock.
 * - `crear: true` sobre un código que ya existe responde 409 con el producto
 *   existente, en vez de sobrescribirlo.
 * - Un alta sin `is_active` queda activa (el default de la columna es false).
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

    const barcodes = items.map((i) => String(i.barcode));
    const { data: filas, error: errExistentes } = await supabaseServer
      .from("products")
      .select("barcode, name, is_active, stock")
      .in("barcode", barcodes);
    if (errExistentes) throw errExistentes;
    const existentes = new Map(((filas ?? []) as Existente[]).map((f) => [String(f.barcode), f]));

    for (const item of items) {
      const actual = existentes.get(String(item.barcode));
      if (item.crear === true && actual) {
        const nombre = actual.name ?? "otro producto";
        return NextResponse.json(
          {
            error: `Ese código ya es «${nombre}»${actual.is_active === false ? " (desactivado)" : ""}`,
            existente: {
              barcode: actual.barcode,
              name: actual.name,
              isActive: actual.is_active !== false,
            },
          },
          { status: 409 }
        );
      }
    }

    // El stock sale del payload y se aplica aparte, sobre branch_stock.
    const stockObjetivo: CountItem[] = [];
    const avisos: string[] = [];
    const payloads = items.map((item) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { stock, stockAnterior, crear, v, ...resto } = item;
      const codigo = String(item.barcode);
      const actual = existentes.get(codigo);

      if (!(Number(resto.purchase_price) > 0)) delete resto.purchase_price;
      for (const k of NO_PISAR_SI_VACIO) if (vacio(resto[k])) delete resto[k];

      if (actual) {
        if (v !== 2) {
          for (const k of NO_PISAR_SI_VACIO_LEGACY) if (vacio(resto[k])) delete resto[k];
          if (!(Number(resto.sale_price) > 0)) delete resto.sale_price;
        }
      } else if (resto.is_active === undefined) {
        resto.is_active = true;
      }

      const qty = Number(stock);
      const stockValido = stock !== undefined && stock !== null && Number.isFinite(qty) && qty >= 0;
      if (stockValido && !actual) {
        stockObjetivo.push({ barcode: codigo, qty });
      } else if (stockValido && actual && stockAnterior !== undefined && stockAnterior !== null) {
        const anterior = Number(stockAnterior);
        const real = Number(actual.stock ?? 0);
        if (Math.abs(qty - anterior) > 1e-9) {
          if (Math.abs(real - anterior) < 1e-9) {
            stockObjetivo.push({ barcode: codigo, qty });
          } else {
            avisos.push(
              `El stock de ${actual.name ?? codigo} cambió a ${real} mientras editabas: no se aplicó tu cambio`
            );
          }
        }
      }

      return resto;
    });

    // Los productos primero: `apply_stock_absolute` ignora los códigos que no
    // existen todavía, así que un alta con stock necesita este orden.
    await upsertProductsWithColumnFallback(payloads);

    let stockAplicado = 0;
    let stockError: string | null = avisos.length > 0 ? avisos.join(". ") : null;

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
      else stockError = [stockError, res.error].filter(Boolean).join(". ");
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
