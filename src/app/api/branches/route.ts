import { NextResponse } from "next/server";
import { getBranches } from "@/server/branches.service";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/** GET /api/branches — sucursales activas. */
export async function GET() {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const branches = await getBranches();
    return NextResponse.json({ branches });
  } catch (e) {
    return errorResponse(e);
  }
}
