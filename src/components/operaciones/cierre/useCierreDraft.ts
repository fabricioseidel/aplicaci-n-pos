"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AbonoInput, FiadoInput, TransferInput, VoucherInput } from "@/lib/cierre/types";

export interface CierreDraft {
  denominations: Record<number, number>;
  /** Sólo se usa cuando no se alcanzó a desglosar el efectivo. */
  cashCounted: number | null;
  transfers: TransferInput[];
  vouchers: VoucherInput[];
  fiados: FiadoInput[];
  abonos: AbonoInput[];
  notes: string;
}

const EMPTY: CierreDraft = {
  denominations: {},
  cashCounted: null,
  transfers: [],
  vouchers: [],
  fiados: [],
  abonos: [],
  notes: "",
};

const key = (shiftId: string) => `pos.cierre.${shiftId}`;

/**
 * Borrador del cierre, guardado en el teléfono mientras se llena.
 *
 * Contar la caja toma varios minutos y en el mostrador el celular se bloquea,
 * entra una llamada o se cambia de app. Sin esto, volver a la pestaña empezaba
 * el conteo de cero — que es justo el momento en que la gente abandona y se
 * vuelve al cuaderno.
 */
export function useCierreDraft(shiftId: string | null) {
  const [draft, setDraft] = useState<CierreDraft>(EMPTY);
  const [restored, setRestored] = useState(false);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!shiftId || loadedFor.current === shiftId) return;
    loadedFor.current = shiftId;
    try {
      const raw = localStorage.getItem(key(shiftId));
      if (raw) {
        setDraft({ ...EMPTY, ...(JSON.parse(raw) as Partial<CierreDraft>) });
        setRestored(true);
        return;
      }
    } catch {
      /* borrador ilegible: se empieza limpio */
    }
    setDraft(EMPTY);
    setRestored(false);
  }, [shiftId]);

  useEffect(() => {
    if (!shiftId || loadedFor.current !== shiftId) return;
    try {
      localStorage.setItem(key(shiftId), JSON.stringify(draft));
    } catch {
      /* cuota llena: se pierde el respaldo, no el cierre en curso */
    }
  }, [shiftId, draft]);

  const patch = useCallback((cambios: Partial<CierreDraft>) => {
    setDraft((d) => ({ ...d, ...cambios }));
  }, []);

  const clear = useCallback(() => {
    if (shiftId) {
      try {
        localStorage.removeItem(key(shiftId));
      } catch {
        /* noop */
      }
    }
    setDraft(EMPTY);
    setRestored(false);
  }, [shiftId]);

  return { draft, patch, clear, restored };
}

export type { AbonoInput, FiadoInput, TransferInput, VoucherInput };
