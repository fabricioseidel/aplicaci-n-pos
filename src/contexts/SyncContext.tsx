"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { countPending, markDone, markFailed, markSyncing, pendingOps } from "@/lib/offline/db";

const POLL_MS = 20_000;

interface SyncContextType {
  /** Operaciones que aún no llegaron al servidor. */
  pending: number;
  /** Está drenando el outbox ahora mismo. */
  syncing: boolean;
  isOnline: boolean;
  /** Fuerza un intento de sincronización. */
  syncNow: () => Promise<void>;
  /** Lo llaman las pantallas al encolar algo, para refrescar el badge. */
  refreshPending: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

/**
 * Drena el outbox de IndexedDB: se dispara al volver la conexión y cada 20 s
 * mientras haya red. Reintento simple, sin backoff exponencial — en el local
 * la red vuelve entera o no vuelve, y un backoff largo sólo haría que el
 * cajero esperara de más viendo el punto naranja.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  // Evita que el poll y el evento `online` dreñen la cola a la vez y manden
  // la misma operación dos veces.
  const drainingRef = useRef(false);

  const refreshPending = useCallback(async () => {
    try {
      setPending(await countPending());
    } catch {
      /* IndexedDB no disponible (modo privado): el POS sigue online-only */
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (drainingRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    drainingRef.current = true;
    setSyncing(true);
    try {
      const ops = await pendingOps();
      for (const op of ops) {
        try {
          await markSyncing(op.id);
          const res = await fetch(op.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(op.payload),
          });

          if (res.ok) {
            await markDone(op.id);
            continue;
          }

          const body = await res.json().catch(() => ({}));

          /**
           * 4xx (salvo 408/429) es un rechazo definitivo: el servidor no va a
           * cambiar de opinión reintentando. Se marca como fallida y se deja
           * en la cola visible para que alguien la revise, en vez de borrarla
           * en silencio — si una venta no entró, hay que saberlo.
           */
          await markFailed(
            op.id,
            body?.error || `HTTP ${res.status}`,
            op.attempts + 1
          );
        } catch (err) {
          // Se cayó la red a mitad del drenaje: se deja pendiente para el
          // siguiente intento. Las ventas son idempotentes por clientSaleId,
          // así que reintentar una que quizá sí entró no la duplica.
          await markFailed(
            op.id,
            err instanceof Error ? err.message : "Error de red",
            op.attempts + 1
          );
          break;
        }
      }
    } finally {
      drainingRef.current = false;
      setSyncing(false);
      await refreshPending();
    }
  }, [refreshPending]);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    void refreshPending();
    void syncNow();

    const handleOnline = () => {
      setIsOnline(true);
      void syncNow();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const timer = setInterval(() => {
      if (navigator.onLine) void syncNow();
    }, POLL_MS);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(timer);
    };
  }, [syncNow, refreshPending]);

  return (
    <SyncContext.Provider value={{ pending, syncing, isOnline, syncNow, refreshPending }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}
