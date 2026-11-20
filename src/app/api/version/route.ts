import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * GET /api/version → la versión publicada ahora mismo.
 *
 * El valor se fija al compilar, igual que el que lleva el teléfono: si no
 * coinciden, el teléfono está corriendo una versión vieja y se actualiza.
 */
export function GET() {
  return NextResponse.json({ version: APP_VERSION }, { headers: { "Cache-Control": "no-store" } });
}
