import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import type { CambioDePrecioHoy } from "@/lib/products/edicion";

export const dynamic = "force-dynamic";


/** Inicio del día de hoy en Chile, como instante UTC. */
function inicioDelDiaEnChile(ahora = new Date()): string {
  const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(ahora);
  // Medianoche en Santiago: se prueba con los dos husos posibles (-03/-04)
  // y se queda el que, visto desde Santiago, cae en `fecha` a las 00:00.
  for (const off of ["-03:00", "-04:00"]) {
    const d = new Date(`${fecha}T00:00:00${off}`);
    const hora = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Santiago",
      hour: "2-digit",
      hour12: false,
    }).format(d);
    if (hora === "00") return d.toISOString();
  }
  return new Date(`${fecha}T00:00:00-03:00`).toISOString();
}

/**
 * GET /api/products/cambios — precios y ofertas cambiados hoy, con quién.
 *
 * Lee `audit_logs` (`products.save`), que es donde registran los cambios de
 * precio tanto el POS como OlivoWeb. Sólo precio y oferta: el costo no se
 * muestra acá porque esta lista la ve todo el personal.
 */
export async function GET() {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await supabaseServer
      .from("audit_logs")
      .select("created_at, actor, details")
      .eq("action", "products.save")
      .gte("created_at", inicioDelDiaEnChile())
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;

    const cambios: CambioDePrecioHoy[] = [];
    for (const fila of data ?? []) {
      const lista = (fila.details as { cambiosDePrecio?: unknown } | null)?.cambiosDePrecio;
      if (!Array.isArray(lista)) continue;
      for (const c of lista as Array<Record<string, unknown>>) {
        if (c.campo !== "sale_price" && c.campo !== "offer_price") continue;
        cambios.push({
          cuando: String(fila.created_at),
          quien: String(fila.actor ?? "—"),
          barcode: String(c.barcode ?? ""),
          nombre: (c.nombre as string | null) ?? null,
          campo: c.campo,
          antes: c.antes === null || c.antes === undefined ? null : Number(c.antes),
          despues: c.despues === null || c.despues === undefined ? null : Number(c.despues),
        });
      }
    }

    // OlivoWeb no guarda el nombre: se completa desde products.
    const sinNombre = [...new Set(cambios.filter((c) => !c.nombre).map((c) => c.barcode))];
    if (sinNombre.length) {
      const { data: prods } = await supabaseServer.from("products").select("barcode, name").in("barcode", sinNombre);
      const nombres = new Map((prods ?? []).map((p) => [String(p.barcode), p.name as string | null]));
      for (const c of cambios) if (!c.nombre) c.nombre = nombres.get(c.barcode) ?? null;
    }

    return NextResponse.json({ cambios });
  } catch (e) {
    return errorResponse(e);
  }
}
