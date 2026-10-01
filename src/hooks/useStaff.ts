"use client";

import { useEffect, useState } from "react";

export interface StaffMember {
  /** `sellers.id`: es lo que queda en `sales.seller_id` de la compra propia. */
  id: string;
  name: string;
}

const CACHE_KEY = "pos.staff.v1";

function readCache(): StaffMember[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as StaffMember[]) : [];
  } catch {
    return [];
  }
}

/**
 * Empleados que pueden hacer una compra propia (tabla `sellers`, activos).
 *
 * La compra propia se le carga a quien compra, no a quien tiene la sesión
 * abierta: en el mostrador la cuenta se comparte y la que cobra no siempre es
 * la que compra. Por eso la lista se pide aparte y se recuerda en el equipo —
 * sin wifi también hay que poder decir de quién es la compra.
 */
export function useStaff(): { staff: StaffMember[]; loading: boolean } {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setStaff(readCache());
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sellers", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { sellers?: StaffMember[] };
        const list = (data.sellers ?? [])
          // "ADMIN PRINCIPAL" es una cuenta, no una persona que compre.
          .filter((s) => !/^admin\b/i.test(s.name.trim()))
          .map((s) => ({ id: s.id, name: s.name }));
        if (cancelled) return;
        setStaff(list);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(list));
        } catch {
          /* sin localStorage: la lista vale igual para esta sesión */
        }
      } catch {
        /* sin red: queda la lista recordada */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { staff, loading };
}

/** "MARIANA" → "Mariana": los nombres se guardan en mayúsculas. */
export function staffDisplayName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());
}
