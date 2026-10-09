"use client";

import React, { useState } from "react";
import { ArrowPathIcon, XMarkIcon } from "@heroicons/react/24/outline";
import MoneyInput from "@/components/ui/MoneyInput";
import SelectorCuenta, { type CuentaElegida } from "../cierre/SelectorCuenta";
import { avisoAbono } from "@/lib/cierre/cuentas";
import { useToast } from "@/contexts/ToastContext";
import { useBranch } from "@/contexts/BranchContext";
import { useAttendant } from "@/hooks/useAttendant";
import { clp } from "@/lib/cierre/denominations";
import type { CustomerBalance } from "@/lib/cierre/types";

type Metodo = "CASH" | "TRANSFER" | "CARD";
const METODOS: { id: Metodo; label: string }[] = [
  { id: "CASH", label: "Efectivo" },
  { id: "TRANSFER", label: "Transfer." },
  { id: "CARD", label: "Tarjeta" },
];

/**
 * Anotar un fiado o un abono en el momento, sin esperar al cierre.
 *
 * Queda en el turno abierto y el cierre lo trae solo (ver `sumarDelDia`),
 * así la caja cuadra igual y no hay que acordarse al final del día.
 */
export default function AnotarCuenta({
  tipo,
  cuentas,
  inicial,
  onCerrar,
  onListo,
}: {
  tipo: "CHARGE" | "PAYMENT";
  cuentas: CustomerBalance[];
  inicial?: CuentaElegida | null;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const { showToast } = useToast();
  const { currentBranch } = useBranch();
  const { attendant } = useAttendant();
  const [cuenta, setCuenta] = useState<CuentaElegida | null>(inicial ?? null);
  const [monto, setMonto] = useState<number | null>(null);
  const [metodo, setMetodo] = useState<Metodo>("CASH");
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Un id por intento: reintentar el mismo envío no lo anota dos veces.
  const [id] = useState(() => crypto.randomUUID());

  const guardar = async () => {
    if (!cuenta || !monto || monto <= 0 || enviando) return;
    if (tipo === "PAYMENT") {
      const aviso = avisoAbono(cuenta.balance, monto, cuenta.name, clp);
      if (aviso && !window.confirm(aviso)) return;
    }
    setEnviando(true);
    try {
      const res = await fetch("/api/cuentas/movimiento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          accountId: cuenta.id,
          nombreNuevo: cuenta.id ? null : cuenta.name,
          kind: tipo,
          amount: monto,
          method: tipo === "PAYMENT" ? metodo : null,
          note: nota.trim() || null,
          branchId: currentBranch?.id ?? null,
          atendio: attendant?.name ?? null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(data.error ?? "No se pudo anotar", "error");
        return;
      }
      showToast(
        tipo === "CHARGE" ? `Fiado anotado: ${cuenta.name} ${clp(monto)}` : `Abono anotado: ${cuenta.name} ${clp(monto)}`,
        "success"
      );
      onListo();
    } catch {
      showToast("Sin conexión: no se anotó. Reintenta con red.", "error");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/85 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl p-5 text-white space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">{tipo === "CHARGE" ? "Anotar fiado" : "Registrar abono"}</h2>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="p-2 -m-2 text-white/50">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>
        <SelectorCuenta
          cuentas={cuentas}
          valor={cuenta}
          onChange={setCuenta}
          etiqueta={tipo === "CHARGE" ? "¿A quién se le fía?" : "¿Quién paga?"}
        />
        <MoneyInput
          value={monto}
          onChange={setMonto}
          aria-label="Monto"
          placeholder="Monto"
          className="w-full bg-black border-2 border-white/10 rounded-2xl px-4 h-14 text-2xl font-black text-white text-center outline-none focus:border-emerald-500"
        />
        {tipo === "PAYMENT" && (
          <div className="grid grid-cols-3 gap-1.5">
            {METODOS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetodo(m.id)}
                className={`h-12 rounded-xl border text-xs font-black uppercase ${
                  metodo === m.id ? "bg-white text-black border-white" : "bg-white/5 border-white/10 text-white/70"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder={tipo === "CHARGE" ? "Qué se llevó (opcional)" : "Nota (opcional)"}
          className="w-full h-12 bg-black border border-white/10 rounded-xl px-3 text-sm text-white outline-none focus:border-emerald-500"
        />
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={!cuenta || !monto || enviando}
          className="w-full h-14 rounded-xl bg-emerald-500 text-black text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-30"
        >
          {enviando && <ArrowPathIcon className="h-5 w-5 animate-spin" />}
          {tipo === "CHARGE" ? "Anotar fiado" : "Registrar abono"}
        </button>
        <p className="text-[11px] text-white/40">Queda en la caja de hoy y aparece solo en el cierre.</p>
      </div>
    </div>
  );
}
