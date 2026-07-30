"use client";

import { enqueue, newId, type OutboxKind } from "./db";

export type WriteResult<T = unknown> =
  | { ok: true; queued: false; data: T; id: string }
  /** Guardado en el outbox: la UI muestra éxito optimista + "pendiente". */
  | { ok: true; queued: true; id: string }
  | { ok: false; queued: false; error: string; status?: number };

interface ApiWriteOptions {
  kind: OutboxKind;
  url: string;
  payload: Record<string, unknown>;
  /**
   * UUID de cliente reusado como clave de idempotencia. Si no se pasa se
   * genera uno. Para ventas viaja además como `clientSaleId` en el body.
   */
  id?: string;
  /**
   * Si es false, la operación nunca se encola y el fallo de red se reporta.
   * Se usa para escrituras que no tienen sentido diferidas (p. ej. cerrar
   * caja necesita respuesta inmediata con el cuadre).
   */
  queueable?: boolean;
}

/** Un fallo de `fetch` (TypeError) significa "no hubo red", no "el servidor dijo que no". */
function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && /network|failed to fetch/i.test(err.message));
}

/**
 * Única puerta de escritura del cliente.
 *
 * Con red: hace el POST de verdad. Sin red (o si el fetch falla por red):
 * guarda la operación en el outbox de IndexedDB y responde `queued: true`
 * para que la UI confirme igual y muestre el indicador de pendiente.
 *
 * Un error HTTP del servidor (4xx/5xx) NO se encola a propósito: reintentar
 * en bucle un "carrito vacío" o un "no hay caja abierta" nunca va a funcionar
 * y dejaría basura acumulándose en la cola. Sólo se difiere la falta de red.
 */
export async function apiWrite<T = unknown>(opts: ApiWriteOptions): Promise<WriteResult<T>> {
  const id = opts.id ?? newId();
  const queueable = opts.queueable !== false;
  const payload = { ...opts.payload };

  const queue = async (): Promise<WriteResult<T>> => {
    if (!queueable) {
      return { ok: false, queued: false, error: "Sin conexión. Intenta de nuevo." };
    }
    await enqueue({ id, kind: opts.kind, url: opts.url, payload });
    return { ok: true, queued: true, id };
  };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return queue();
  }

  try {
    const res = await fetch(opts.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        queued: false,
        error: body?.error || `Error ${res.status}`,
        status: res.status,
      };
    }

    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: true, queued: false, data, id };
  } catch (err) {
    if (isNetworkFailure(err)) return queue();
    return {
      ok: false,
      queued: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}
