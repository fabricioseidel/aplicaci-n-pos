"use client";

import Dexie, { type Table } from "dexie";
import type { ProductUI } from "@/types";

/** Tipos de escritura que la app sabe encolar y reintentar. */
export type OutboxKind = "sale" | "movement" | "shiftOpen" | "shiftClose" | "reception" | "transfer";

export type OutboxStatus = "pending" | "syncing" | "failed";

export interface OutboxOp {
  /** UUID generado en el cliente. Para las ventas es además el clientSaleId. */
  id: string;
  kind: OutboxKind;
  /** Endpoint al que se reenvía tal cual cuando vuelve la red. */
  url: string;
  payload: unknown;
  createdAt: number;
  status: OutboxStatus;
  attempts: number;
  lastError?: string | null;
}

/** Fila del catálogo cacheado para poder buscar/vender sin conexión. */
export interface CachedProduct extends ProductUI {
  /** `barcode` es la clave primaria: es el identificador de negocio. */
  barcode: string;
  cachedAt: number;
}

class PosDatabase extends Dexie {
  productsCache!: Table<CachedProduct, string>;
  outbox!: Table<OutboxOp, string>;

  constructor() {
    super("olivo-pos");
    this.version(1).stores({
      // Índices por nombre para el buscador offline.
      productsCache: "barcode, name, updatedAt",
      // createdAt indexado: el outbox se drena FIFO (lo más viejo primero).
      outbox: "id, status, createdAt, kind",
    });
  }
}

/**
 * Dexie toca IndexedDB en el constructor, así que la instancia se crea
 * perezosamente y sólo en el navegador: importarla desde un componente que
 * también se renderiza en el servidor reventaría el build.
 */
let _db: PosDatabase | null = null;

export function getDb(): PosDatabase {
  if (typeof window === "undefined") {
    throw new Error("La base offline sólo existe en el navegador");
  }
  if (!_db) _db = new PosDatabase();
  return _db;
}

/** UUID del cliente. `crypto.randomUUID` no existe en contextos no seguros. */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

// ── Catálogo ────────────────────────────────────────────────────────────

export async function cacheProducts(products: ProductUI[]): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const rows: CachedProduct[] = products.map((p) => ({
    ...p,
    barcode: p.barcode || p.id,
    cachedAt: now,
  }));
  // Se reemplaza el catálogo entero: un producto borrado en el servidor no
  // debe seguir vendiéndose desde la caché local.
  await db.transaction("rw", db.productsCache, async () => {
    await db.productsCache.clear();
    await db.productsCache.bulkPut(rows);
  });
}

export async function readCachedProducts(): Promise<ProductUI[]> {
  const db = getDb();
  return (await db.productsCache.toArray()) as ProductUI[];
}

export async function countCachedProducts(): Promise<number> {
  return getDb().productsCache.count();
}

// ── Outbox ──────────────────────────────────────────────────────────────

export async function enqueue(op: Omit<OutboxOp, "createdAt" | "status" | "attempts">) {
  const db = getDb();
  const row: OutboxOp = {
    ...op,
    createdAt: Date.now(),
    status: "pending",
    attempts: 0,
  };
  await db.outbox.put(row);
  return row;
}

/**
 * Tras este número de intentos fallidos la operación deja de reintentarse
 * sola, pero SIGUE en la cola y contando en el badge: si una venta no entró,
 * alguien tiene que enterarse, no borrarla en silencio.
 */
export const MAX_ATTEMPTS = 10;

/** Operaciones a reenviar, más antiguas primero (FIFO). */
export async function pendingOps(): Promise<OutboxOp[]> {
  const db = getDb();
  const rows = await db.outbox.toArray();
  return rows
    .filter((o) => o.status !== "syncing" && o.attempts < MAX_ATTEMPTS)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Devuelve a "pending" lo que quedó marcado como "syncing".
 *
 * Si la pestaña se cerró (o el teléfono se bloqueó) a mitad de un envío, la
 * operación queda colgada en "syncing" y `pendingOps` no la volvería a tomar
 * nunca. Se llama al arrancar el proveedor de sincronización.
 */
export async function resetStuckOps(): Promise<void> {
  const db = getDb();
  const stuck = await db.outbox.where("status").equals("syncing").toArray();
  await Promise.all(stuck.map((o) => db.outbox.update(o.id, { status: "pending" })));
}

export async function countPending(): Promise<number> {
  const db = getDb();
  return db.outbox.count();
}

export async function markSyncing(id: string) {
  await getDb().outbox.update(id, { status: "syncing" });
}

export async function markDone(id: string) {
  await getDb().outbox.delete(id);
}

export async function markFailed(id: string, error: string, attempts: number) {
  await getDb().outbox.update(id, {
    status: "failed",
    attempts,
    lastError: error,
  });
}
