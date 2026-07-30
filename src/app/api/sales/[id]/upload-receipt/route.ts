import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/:id/upload-receipt
 * Sube el comprobante de transferencia al bucket `uploads` de Supabase Storage
 * y guarda la URL pública en la venta.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { id: saleId } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 });
    }

    const validTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo de archivo no válido. Use JPG, PNG, WEBP o HEIC" },
        { status: 400 }
      );
    }

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 10);
    const ext = file.name.split(".").pop() || "jpg";
    const fileName = `comprobante-${saleId}-${timestamp}-${randomStr}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabaseServer.storage
      .from("uploads")
      .upload(fileName, buffer, { contentType: file.type, upsert: false });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabaseServer.storage.from("uploads").getPublicUrl(fileName);
    const publicUrl = urlData.publicUrl;

    const { error: updateError } = await supabaseServer
      .from("sales")
      .update({ transfer_receipt_uri: publicUrl, transfer_receipt_name: fileName })
      .eq("id", saleId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, url: publicUrl, fileName });
  } catch (error) {
    console.error("[sales/upload-receipt]", error);
    return NextResponse.json({ error: "Error al subir comprobante" }, { status: 500 });
  }
}
