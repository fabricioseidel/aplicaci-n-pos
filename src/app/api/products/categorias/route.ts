import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * GET /api/products/categorias — nombres de las categorías activas, para
 * elegir de una lista en vez de escribir ("Bebidas", "bebidas ", "Bebida"…).
 */
export async function GET() {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await supabaseServer
      .from("categories")
      .select("name")
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    const categorias = [...new Set((data ?? []).map((c) => String(c.name).trim()).filter(Boolean))];
    return NextResponse.json({ categorias });
  } catch (e) {
    return errorResponse(e);
  }
}
