"use client";

import { useCallback, useEffect, useState } from "react";

interface ShiftState {
  /** null mientras carga. */
  open: boolean | null;
  shiftId: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const CACHE_KEY = "pos.openShift.v1";

/**
 * Estado del turno de caja EN LA SUCURSAL ACTIVA. El POS lo usa para bloquear
 * la venta cuando no hay caja abierta; el servidor valida lo mismo al
 * registrar (esto es sólo la UI). Cada sucursal tiene su propia caja, así
 * que el resultado cambia con `branchId` — matriz y sucursal pueden tener
 * turnos abiertos en simultáneo sin pisarse.
 *
 * A diferencia de OlivoWeb, un fallo de red NO cierra la venta: si el cajero
 * ya abrió caja y se cae el wifi, seguir vendiendo (y encolar) es justamente
 * lo que esta app tiene que permitir. Se recuerda el último estado conocido,
 * por sucursal.
 */
export function useOpenShift(branchId?: string | null): ShiftState {
  const [open, setOpen] = useState<boolean | null>(null);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const cacheKey = branchId ? `${CACHE_KEY}.${branchId}` : CACHE_KEY;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const url = branchId
        ? `/api/caja/estado?branchId=${encodeURIComponent(branchId)}`
        : "/api/caja/estado";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { open?: boolean; shiftId?: string | null };
      setOpen(Boolean(data.open));
      setShiftId(data.shiftId ?? null);
      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({ open: Boolean(data.open), shiftId: data.shiftId ?? null })
        );
      } catch {
        /* noop */
      }
    } catch {
      // Sin red: se cae al último estado conocido de esta sucursal.
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const cached = JSON.parse(raw) as { open: boolean; shiftId: string | null };
          setOpen(cached.open);
          setShiftId(cached.shiftId);
        } else {
          setOpen(false);
          setShiftId(null);
        }
      } catch {
        setOpen(false);
        setShiftId(null);
      }
    } finally {
      setLoading(false);
    }
  }, [branchId, cacheKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { open, shiftId, loading, refresh };
}
