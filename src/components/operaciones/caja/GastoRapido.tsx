"use client";

import React, { useState } from "react";
import { ArrowPathIcon, ShoppingBagIcon } from "@heroicons/react/24/outline";
import MoneyInput from "@/components/ui/MoneyInput";
import { clp } from "@/lib/cierre/denominations";
import Hoja from "./Hoja";
import type { NuevoMovimiento } from "./Movimientos";

const MOTIVOS = ["Bolsas", "Aseo", "Hielo", "Pan", "Gas", "Movilización", "Otro"];

/** Texto con el que queda el gasto en el movimiento de caja. */
export function motivoDeGasto(chip: string | null, detalle: string): string {
  const d = detalle.trim();
  const base = chip && chip !== "Otro" ? chip : "";
  const texto = [base, d].filter(Boolean).join(" · ");
  return `Gasto: ${texto || "varios"}`;
}

/**
 * Gasto rápido pagado con plata de la caja: una compra chica del día (bolsas,
 * aseo, hielo…). Es un egreso en efectivo con el motivo "Gasto: …": baja lo
 * que debe haber en el cajón y queda en "Movimientos del turno" y en el cierre.
 * Se confirma antes de registrar porque un movimiento no se borra.
 */
export default function GastoRapido({
  onRegistrar,
}: {
  onRegistrar: (m: NuevoMovimiento) => Promise<boolean>;
}) {
  const [monto, setMonto] = useState<number | null>(null);
  const [chip, setChip] = useState<string | null>(null);
  const [detalle, setDetalle] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const valido = monto !== null && monto > 0 && (chip !== null || detalle.trim() !== "");
  const motivo = motivoDeGasto(chip, detalle);

  const registrar = async () => {
    if (!valido || guardando) return;
    setGuardando(true);
    try {
      const ok = await onRegistrar({ amount: monto!, type: "OUT", method: "CASH", reason: motivo });
      if (ok) {
        setMonto(null);
        setChip(null);
        setDetalle("");
        setConfirmar(false);
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-3">
      <p className="text-xs font-black uppercase tracking-widest text-white/50 flex items-center gap-2">
        <ShoppingBagIcon className="w-4 h-4" /> Gasto rápido en efectivo
      </p>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-black text-white/30">$</span>
        <MoneyInput
          aria-label="Monto del gasto"
          placeholder="Monto"
          value={monto}
          onChange={setMonto}
          className="w-full h-12 bg-black border border-white/10 rounded-xl pl-8 pr-3 text-lg font-black text-white outline-none focus:border-emerald-500 tabular-nums"
        />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de gasto">
        {MOTIVOS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={chip === m}
            onClick={() => setChip(chip === m ? null : m)}
            className={`h-11 px-3 rounded-xl text-xs font-black border ${
              chip === m
                ? "bg-emerald-500 border-emerald-400 text-black"
                : "bg-black border-white/10 text-white/60 active:bg-white/10"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Qué se compró (opcional si elegiste uno)"
        aria-label="Detalle del gasto"
        value={detalle}
        onChange={(e) => setDetalle(e.target.value)}
        className="w-full h-12 bg-black border border-white/10 rounded-xl px-3 text-base text-white outline-none focus:border-emerald-500"
      />
      <button
        type="button"
        onClick={() => setConfirmar(true)}
        disabled={!valido}
        className="w-full h-12 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl text-sm font-black uppercase tracking-widest active:bg-red-500/20 disabled:opacity-30"
      >
        Registrar gasto
      </button>

      {confirmar && valido && (
        <Hoja titulo="Confirmar gasto" onClose={() => !guardando && setConfirmar(false)}>
          <div className="text-center space-y-2 py-2">
            <p className="text-sm font-black uppercase tracking-widest text-white/50">Sale de la caja</p>
            <p className="text-4xl font-black tabular-nums text-red-400">− {clp(monto)}</p>
            <p className="text-base text-white">
              en <span className="font-black">efectivo</span>
            </p>
            <p className="text-base text-white/60">{motivo}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirmar(false)}
              disabled={guardando}
              className="h-14 rounded-2xl bg-white/5 text-white/70 text-sm font-black uppercase tracking-widest active:bg-white/10"
            >
              Corregir
            </button>
            <button
              type="button"
              onClick={registrar}
              disabled={guardando}
              className="h-14 rounded-2xl bg-red-500 active:bg-red-600 text-black text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40"
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
