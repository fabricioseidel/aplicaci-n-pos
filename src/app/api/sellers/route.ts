import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * GET /api/sellers — vendedores (empleados físicos) con el email/rol de su
 * usuario asociado. `sellers.user_id` apunta a `users.id`.
 */
export async function GET() {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { data: sellersData, error: sellersError } = await supabaseServer
      .from("sellers")
      .select("id, name, user_id")
      .order("name");

    if (sellersError) throw sellersError;

    const userIds = (sellersData ?? []).map((s) => s.user_id).filter(Boolean) as string[];

    let usersMap = new Map<string, { id: string; email: string; role: string }>();
    if (userIds.length > 0) {
      const { data: usersData, error: usersError } = await supabaseServer
        .from("users")
        .select("id, email, role")
        .in("id", userIds);
      if (usersError) throw usersError;
      usersMap = new Map((usersData ?? []).map((u) => [u.id, u as { id: string; email: string; role: string }]));
    }

    const sellers = (sellersData ?? []).map((seller) => {
      const user = seller.user_id ? usersMap.get(seller.user_id) : null;
      return {
        id: seller.id,
        name: seller.name,
        email: user?.email ?? null,
        role: user?.role ?? null,
      };
    });

    return NextResponse.json({ sellers });
  } catch (e) {
    return errorResponse(e);
  }
}
