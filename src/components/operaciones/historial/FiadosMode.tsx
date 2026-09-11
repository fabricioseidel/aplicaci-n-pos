"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ArrowPathIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useToast } from "@/contexts/ToastContext";
import { clp } from "@/lib/cierre/denominations";
import type { CustomerBalance } from "@/lib/cierre/types";
import { Tarjeta, FilaTotal, Vacio } from "../cierre/campos";

interface Movimiento {
  id: string;
  kind: "CHARGE" | "PAYMENT";
  amount: number;
  occurred_on: string;
  method: string | null;
  note: string | null;
  shift_id: string | null;
}

const fecha = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/** Días completos desde una fecha ISO. */
function antiguedad(iso: string | null): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / 86_400_000);
}

/**
 * Estado de los fiados desde el celular.
 *
 * Lee la misma vista `v_customer_balances` que `/admin/fiados` en la web: si se
 * anota un fiado en el cierre del mostrador, el saldo cambia en los dos lados.
 * Los cargos y abonos se registran en el cierre del día — acá sólo se consulta,
 * porque un abono anotado fuera del arqueo deja la caja de ese día sin cuadrar.
 */
export default function FiadosMode() {
  const { showToast } = useToast();
  const [cuentas, setCuentas] = useState<CustomerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [abierta, setAbierta] = useState<CustomerBalance | null>(null);
  const [movimientos, setMovimientos] = useState<Movimiento[] | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cuentas?todas=1", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setCuentas((await res.json()).cuentas ?? []);
    } catch {
      showToast("No se pudieron cargar los fiados", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void cargar(); }, [cargar]);

  const abrir = async (c: CustomerBalance) => {
    setAbierta(c);
    setMovimientos(null);
    try {
      const res = await fetch(`/api/cuentas?id=${c.id}`, { cache: "no-store" });
      setMovimientos(res.ok ? ((await res.json()).movimientos ?? []) : []);
    } catch {
      setMovimientos([]);
    }
  };

  const conDeuda = cuentas.filter((c) => Number(c.balance) > 0);
  const alDia = cuentas.filter((c) => Number(c.balance) <= 0);
  const total = conDeuda.reduce((a, c) => a + Number(c.balance), 0);

  if (loading) {
    return (
      <p className="py-10 text-center text-white/30 text-xs font-black uppercase tracking-widest animate-pulse">
        Cargando…
      </p>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <Tarjeta>
        <FilaTotal label="Total por cobrar" value={clp(total)} destacado />
        <p className="text-[11px] text-white/30">
          {conDeuda.length} persona(s) con deuda
          {alDia.length > 0 && ` · ${alDia.length} al día`}
        </p>
      </Tarjeta>

      {cuentas.length === 0 ? (
        <Vacio>Todavía no hay fiados</Vacio>
      ) : (
        <div className="space-y-2">
          {[...conDeuda, ...alDia].map((c) => {
            const dias = antiguedad(c.oldest_charge);
            const saldo = Number(c.balance);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => void abrir(c)}
                className="w-full text-left bg-white/5 rounded-2xl border border-white/5 p-4 active:bg-white/10 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm font-black text-white">{c.name}</span>
                  <span
                    className={`text-lg font-black tabular-nums ${
                      saldo > 0 ? "text-amber-400" : "text-white/20"
                    }`}
                  >
                    {saldo > 0 ? clp(saldo) : "al día"}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-white/25 tabular-nums">
                  Fiado {clp(c.total_charges)} · pagado {clp(c.total_payments)}
                  {saldo > 0 && dias !== null && ` · ${dias} días`}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {abierta && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={() => setAbierta(null)}>
          <div
            className="w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-[#0a0a0a] border-t border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-[#0a0a0a] border-b border-white/5 px-4 py-3 flex items-center gap-3">
              <div className="min-w-0">
                <p className="text-base font-black text-white truncate">{abierta.name}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                  Debe {clp(abierta.balance)}
                </p>
              </div>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setAbierta(null)}
                aria-label="Cerrar"
                className="w-10 h-10 shrink-0 rounded-xl bg-white/5 text-white/40 flex items-center justify-center"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-2">
              {movimientos === null ? (
                <p className="py-6 text-center text-white/30">
                  <ArrowPathIcon className="w-5 h-5 mx-auto animate-spin" />
                </p>
              ) : movimientos.length === 0 ? (
                <Vacio>Sin movimientos</Vacio>
              ) : (
                movimientos.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white/80">
                        {m.kind === "CHARGE" ? "Se llevó fiado" : "Pagó"}
                      </p>
                      <p className="text-[10px] text-white/25">
                        {fecha(m.occurred_on)}
                        {m.kind === "PAYMENT" && m.method && ` · ${m.method}`}
                        {!m.shift_id && " · ajuste manual"}
                      </p>
                    </div>
                    <span
                      className={`font-black tabular-nums shrink-0 ${
                        m.kind === "CHARGE" ? "text-amber-400" : "text-emerald-400"
                      }`}
                    >
                      {m.kind === "CHARGE" ? "+" : "−"}
                      {clp(m.amount)}
                    </span>
                  </div>
                ))
              )}

              <p className="pt-2 text-[11px] leading-relaxed text-white/30">
                Los fiados y los abonos se anotan al cerrar la caja del día. Registrarlos fuera del
                cierre deja la caja de ese día sin cuadrar.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
