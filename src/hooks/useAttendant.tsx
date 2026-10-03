"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { StaffMember } from "@/hooks/useStaff";

const KEY = "pos.attendant.v1";

interface AttendantCtx {
  /** Quien está atendiendo en este teléfono; null hasta que alguien se elige. */
  attendant: StaffMember | null;
  /** true cuando ya se leyó lo guardado (para no preguntar antes de tiempo). */
  ready: boolean;
  setAttendant: (s: StaffMember | null) => void;
}

const Ctx = createContext<AttendantCtx | null>(null);

/**
 * "¿Quién atiende?" en el teléfono compartido.
 *
 * La sesión es la de quien abrió la caja en la mañana y no dice quién está
 * cobrando ahora. Cambiar de persona son dos toques y no cierra la sesión; lo
 * elegido se recuerda en el teléfono y viaja en cada venta desde el momento
 * en que se hace (una venta encolada sin red queda con quien la cobró).
 */
export function AttendantProvider({ children }: { children: React.ReactNode }) {
  const [attendant, setState] = useState<StaffMember | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as StaffMember;
        if (s && typeof s.id === "string" && typeof s.name === "string") setState(s);
      }
    } catch {
      /* sin localStorage: se pregunta en cada carga */
    }
    setReady(true);
  }, []);

  const setAttendant = useCallback((s: StaffMember | null) => {
    setState(s);
    try {
      if (s) localStorage.setItem(KEY, JSON.stringify({ id: s.id, name: s.name }));
      else localStorage.removeItem(KEY);
    } catch {
      /* noop */
    }
  }, []);

  return <Ctx.Provider value={{ attendant, ready, setAttendant }}>{children}</Ctx.Provider>;
}

export function useAttendant(): AttendantCtx {
  return useContext(Ctx) ?? { attendant: null, ready: true, setAttendant: () => {} };
}
