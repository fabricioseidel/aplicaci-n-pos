"use client";

import React, { useState } from "react";
import { ArrowTrendingDownIcon, ArrowTrendingUpIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import MoneyInput from "@/components/ui/MoneyInput";
import { clp } from "@/lib/cierre/denominations";
import Hoja from "./Hoja";

export type MovementMethod = "CASH" | "CARD" | "TRANSFER" | "OTHER";

export const MOVEMENT_METHOD_LABEL: Record<MovementMethod, string> = {
  CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia", OTHER: "Otro",
};

const METODOS: Array<{ id: MovementMethod; corto: string }> = [
  { id: "CASH", corto: "Efectivo" },
  { id: "CARD", corto: "Tarjeta" },
  { id: "TRANSFER", corto: "Transf." },
  { id: "OTHER", corto: "Otro" },
];

export interface NuevoMovimiento {
  amount: number;
  type: "IN" | "OUT";
  method: MovementMethod;
  reason: string;
}

/**
 * Ingreso o egreso manual de caja.
 *
 * Se confirma antes de registrar ("Egreso de $15.000 en efectivo: pago a
 * proveedor"): un movimiento no se puede borrar, y un cero de más descuadra
 * el esperado del día. El método va con botones y no con un `<select>`, que
 * a 360 px se salía de la pantalla (#24).
 */
export default function Movimientos({
  onRegistrar,
}: {
  /** Devuelve true si quedó registrado (o encolado) para limpiar el formulario. */
  onRegistrar: (m: NuevoMovimiento) => Promise<boolean>;
}) {
  const [monto, setMonto] = useState<number | null>(null);
  const [metodo, setMetodo] = useState<MovementMethod>("CASH");
  const [motivo, setMotivo] = useState("");
  const [confirmar, setConfirmar] = useState<"IN" | "OUT" | null>(null);
  const [guardando, setGuardando] = useState(false);

  const valido = monto !== null && monto > 0;
  const motivoFinal = (tipo: "IN" | "OUT") =>
    motivo.trim() || `${tipo === "IN" ? "Ingreso" : "Egreso"} manual`;

  const registrar = async () => {
    if (!confirmar || !valido || guardando) return;
    setGuardando(true);
    try {
      const ok = await onRegistrar({
        amount: monto!,
        type: confirmar,
        method: metodo,
        reason: motivoFinal(confirmar),
      });
      if (ok) {
        setMonto(null);
        setMotivo("");
        setMetodo("CASH");
        setConfirmar(null);
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-3">
      <p className="text-xs font-black uppercase tracking-widest text-white/50">
        Ingreso / egreso manual
      </p>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-black text-white/30">$</span>
        <MoneyInput
          aria-label="Monto del movimiento"
          placeholder="Monto"
          value={monto}
          onChange={setMonto}
          className="w-full h-12 bg-black border border-white/10 rounded-xl pl-8 pr-3 text-lg font-black text-white outline-none focus:border-emerald-500 tabular-nums"
        />
      </div>
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Método del movimiento">
        {METODOS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={metodo === m.id}
            onClick={() => setMetodo(m.id)}
            className={`h-12 rounded-xl text-xs font-black border transition-colors ${
              metodo === m.id
                ? "bg-emerald-500 border-emerald-400 text-black"
                : "bg-black border-white/10 text-white/60 active:bg-white/10"
            }`}
          >
            {m.corto}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Motivo (ej: pago a proveedor)"
        aria-label="Motivo"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className="w-full h-12 bg-black border border-white/10 rounded-xl px-3 text-base text-white outline-none focus:border-emerald-500"
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setConfirmar("IN")}
          disabled={!valido}
          className="h-12 flex items-center justify-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-sm font-black uppercase tracking-widest active:bg-emerald-500/20 disabled:opacity-30"
        >
          <ArrowTrendingUpIcon className="h-5 w-5" /> Ingreso
        </button>
        <button
          type="button"
          onClick={() => setConfirmar("OUT")}
          disabled={!valido}
          className="h-12 flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl text-sm font-black uppercase tracking-widest active:bg-red-500/20 disabled:opacity-30"
        >
          <ArrowTrendingDownIcon className="h-5 w-5" /> Egreso
        </button>
      </div>

      {confirmar && valido && (
        <Hoja
          titulo={confirmar === "IN" ? "Confirmar ingreso" : "Confirmar egreso"}
          onClose={() => !guardando && setConfirmar(null)}
        >
          <div className="text-center space-y-2 py-2">
            <p className="text-sm font-black uppercase tracking-widest text-white/50">
              {confirmar === "IN" ? "Entra a la caja" : "Sale de la caja"}
            </p>
            <p
              className={`text-4xl font-black tabular-nums ${
                confirmar === "IN" ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {confirmar === "IN" ? "+" : "−"} {clp(monto)}
            </p>
            <p className="text-base text-white">
              en <span className="font-black">{MOVEMENT_METHOD_LABEL[metodo].toLowerCase()}</span>
            </p>
            <p className="text-base text-white/60">{motivoFinal(confirmar)}</p>
            {metodo !== "CASH" && (
              <p className="text-xs text-white/40 leading-relaxed">
                No es efectivo: no cambia lo que debería haber en el cajón.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirmar(null)}
              disabled={guardando}
              className="h-14 rounded-2xl bg-white/5 text-white/70 text-sm font-black uppercase tracking-widest active:bg-white/10"
            >
              Corregir
            </button>
            <button
              type="button"
              onClick={registrar}
              disabled={guardando}
              className={`h-14 rounded-2xl text-black text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40 ${
                confirmar === "IN" ? "bg-emerald-500 active:bg-emerald-600" : "bg-red-500 active:bg-red-600"
              }`}
            >
              {guardando && <ArrowPathIcon className="h-5 w-5 animate-spin" />}
              Registrar
            </button>
          </div>
        </Hoja>
      )}
    </div>
  );
}
