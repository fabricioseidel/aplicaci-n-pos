"use client";

import React, { useEffect, useState } from "react";
import { ArrowPathIcon, PlusCircleIcon } from "@heroicons/react/24/outline";
import MoneyInput from "@/components/ui/MoneyInput";
import { clp } from "@/lib/cierre/denominations";

const ATAJOS = [10000, 20000, 30000, 50000];

/** Más que esto para el sencillo de apertura suele ser un cero de más. */
const APERTURA_ALTA = 200000;

/**
 * Apertura de caja.
 *
 * Antes el campo traía 10.000 escrito, no se seleccionaba al tocarlo (quedaba
 * "1003000000") y "30.000" abría la caja con $30. Ahora se propone lo que el
 * cierre anterior dejó para hoy, se escribe con puntos y hay atajos.
 */
export default function AbrirCaja({
  sucursal,
  cargandoSucursal,
  onReintentarSucursal,
  propuesto,
  propuestoOrigen,
  abriendo,
  onAbrir,
}: {
  sucursal: string | null;
  cargandoSucursal: boolean;
  onReintentarSucursal: () => void;
  propuesto: number | null;
  propuestoOrigen: "deja" | "contado" | null;
  abriendo: boolean;
  onAbrir: (monto: number) => void;
}) {
  const [monto, setMonto] = useState<number | null>(propuesto);
  const [tocado, setTocado] = useState(false);

  // El propuesto llega después del primer render: se usa mientras no se haya
  // escrito nada a mano.
  useEffect(() => {
    if (!tocado) setMonto(propuesto);
  }, [propuesto, tocado]);

  const elegir = (v: number | null) => {
    setTocado(true);
    setMonto(v);
  };

  const sinSucursal = !sucursal;
  const puedeAbrir = !sinSucursal && monto !== null && monto >= 0 && !abriendo;

  return (
    <div className="max-w-sm mx-auto p-6 space-y-5">
      <div className="text-center">
        <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <PlusCircleIcon className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="text-xl font-black uppercase tracking-widest mb-1">Abrir caja</h2>
        <p className="text-white/50 text-sm">
          {sucursal ? (
            <>
              Sucursal <span className="font-black text-white">{sucursal}</span>
            </>
          ) : (
            "Cargando sucursal…"
          )}
        </p>
      </div>

      {sinSucursal && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
          <p className="text-sm text-amber-200 leading-relaxed">
            {cargandoSucursal
              ? "Cargando la sucursal. La caja no se puede abrir sin saber de qué local es."
              : "No se pudo cargar la sucursal. Revisa la conexión y reintenta."}
          </p>
          <button
            type="button"
            onClick={onReintentarSucursal}
            className="w-full h-12 rounded-xl bg-amber-500 text-black text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2 active:bg-amber-600"
          >
            <ArrowPathIcon className={`h-5 w-5 ${cargandoSucursal ? "animate-spin" : ""}`} />
            Reintentar
          </button>
        </div>
      )}

      <div className="space-y-2">
        <label
          htmlFor="efectivo-inicial"
          className="block text-xs font-black uppercase tracking-widest text-white/50"
        >
          ¿Con cuánto efectivo abres?
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-white/30">
            $
          </span>
          <MoneyInput
            id="efectivo-inicial"
            aria-label="Efectivo inicial"
            value={monto}
            onChange={elegir}
            onEnter={() => puedeAbrir && monto !== null && onAbrir(monto)}
            className="w-full h-16 bg-white/5 border-2 border-white/10 rounded-2xl pl-10 pr-4 text-3xl font-black text-white outline-none focus:border-emerald-500 text-center tabular-nums"
          />
        </div>
        {propuesto !== null && (
          <p className="text-xs text-white/45 leading-relaxed">
            {propuestoOrigen === "deja"
              ? `Propuesto: lo que el último cierre dejó para hoy (${clp(propuesto)}).`
              : `Propuesto: lo que se contó en el último cierre (${clp(propuesto)}).`}
          </p>
        )}
        {monto !== null && monto > APERTURA_ALTA && (
          <p className="text-sm font-bold text-amber-400">
            ¿Seguro? {clp(monto)} es mucho para el sencillo de apertura.
          </p>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {ATAJOS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => elegir(v)}
            className={`h-12 text-sm font-black rounded-xl border transition-colors ${
              monto === v
                ? "bg-emerald-500 border-emerald-400 text-black"
                : "bg-white/5 border-white/10 text-white/70 active:bg-white/10"
            }`}
          >
            ${v / 1000}k
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => monto !== null && onAbrir(monto)}
        disabled={!puedeAbrir}
        className="w-full h-14 bg-emerald-500 text-black rounded-2xl font-black uppercase tracking-widest text-sm active:bg-emerald-600 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
      >
        {abriendo && <ArrowPathIcon className="h-5 w-5 animate-spin" />}
        {monto !== null ? `Abrir caja con ${clp(monto)}` : "Escribe el efectivo inicial"}
      </button>
    </div>
  );
}
