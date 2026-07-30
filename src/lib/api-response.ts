import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

function isErrorWithMessage(
  error: unknown
): error is { message: string; code?: string; details?: unknown; hint?: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  );
}

export function errorResponse(error: unknown, status = 500) {
  console.error("API Error:", error);

  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Validation Error", details: error.issues }, { status: 400 });
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status });
  }

  // Los errores de Supabase/PostgREST son objetos planos, no instancias de Error.
  if (isErrorWithMessage(error)) {
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ error: "Internal Server Error" }, { status });
}
