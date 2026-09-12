"use client";

import React from "react";
import { CLP_DENOMINATIONS, BILL_THRESHOLD, clp, denominationTotal } from "@/lib/cierre/denominations";
import { Etiqueta, Tarjeta, FilaTotal, Monto } from "./campos";
import type { CierreDraft } from "./useCierreDraft";

interface Props {
  draft: CierreDraft;
  patch: (c: Partial<CierreDraft>) => void;
  sencilloInicial: number;
  ingresos: number;
  egresos: number;
}

/**
 * Conteo del efectivo.
 *
 * Se cuenta por denominación en vez de anotar un total suelto: con el total
 * solo, un descuadre se sabe que existe pero no por dónde empezar a buscarlo.
 */
export default function PasoEfectivo({ draft, patch, sencilloInicial, ingresos, egresos }: Props) {
  const counts = draft.denominations;
  const hayConteo = Object.values(counts).some((q) => q > 0);
  const totalContado = hayConteo ? denominationTotal(counts) : draft.cashCounted ?? 0;

  // Lo que quedó en el cajón menos lo que había al abrir y los movimientos que
  // no son venta. Los abonos de fiado se descuentan en el paso de fiados.
  const ventasEfectivo = totalContado - sencilloInicial - ingresos + egresos;

  const setCount = (d: number, q: number) =>
    patch({ denominations: { ...counts, [d]: Math.max(0, q) } });

  return (
    <div className="space-y-4">
      <Tarjeta titulo="Conteo de billetes y monedas">
        <div className="space-y-1.5">
          {CLP_DENOMINATIONS.map((d) => {
            const q = counts[d] || 0;
            const esBillete = d >= BILL_THRESHOLD;
            return (
              <div key={d} className="flex items-center gap-2">
                <span
                  className={`w-16 shrink-0 text-sm font-black tabular-nums ${
                    esBillete ? "text-white" : "text-white/45"
                  }`}
                >
                  {d.toLocaleString("es-CL")}
                </span>
                <button
                  type="button"
                  aria-label={`Quitar un ${d}`}
                  onClick={() => setCount(d, q - 1)}
                  disabled={q === 0}
                  className="w-10 h-10 shrink-0 rounded-lg bg-white/5 text-white/60 text-lg font-black disabled:opacity-20 active:bg-white/10"
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label={`Cantidad de ${d}`}
                  data-laser-passthrough
                  value={q === 0 ? "" : q}
                  onChange={(e) => setCount(d, Number(e.target.value) || 0)}
                  placeholder="0"
                  className="w-14 shrink-0 bg-black border border-white/10 rounded-lg h-10 text-center font-black text-white outline-none focus:border-emerald-500 tabular-nums"
                />
                <button
                  type="button"
                  aria-label={`Agregar un ${d}`}
                  onClick={() => setCount(d, q + 1)}
                  className="w-10 h-10 shrink-0 rounded-lg bg-white/5 text-white/60 text-lg font-black active:bg-white/10"
                >
                  +
                </button>
                <span className="flex-1 text-right text-sm font-bold text-white/50 tabular-nums">
                  {q > 0 ? clp(d * q) : ""}
                </span>
              </div>
            );
          })}
        </div>
      </Tarjeta>

      {!hayConteo && (
        <Tarjeta titulo="¿Sin tiempo para desglosar?">
          <Etiqueta>Total contado en caja</Etiqueta>
          <Monto
            aria-label="Total contado en caja"
            value={draft.cashCounted}
            onChange={(v) => patch({ cashCounted: v })}
          />
          <p className="text-[10px] leading-relaxed text-white/30">
            Si cuentas por denominación arriba, este campo se ignora.
          </p>
        </Tarjeta>
      )}

      <Tarjeta>
        <FilaTotal label="Contado en caja" value={clp(totalContado)} />
        <FilaTotal label="− Sencillo inicial" value={clp(sencilloInicial)} />
        {ingresos > 0 && <FilaTotal label="− Ingresos manuales" value={clp(ingresos)} />}
        {egresos > 0 && <FilaTotal label="+ Retiros y gastos" value={clp(egresos)} />}
        <div className="pt-2 border-t border-white/10">
          <FilaTotal label="Ventas en efectivo" value={clp(ventasEfectivo)} destacado />
        </div>
        {ventasEfectivo < 0 && (
          <p className="text-[11px] leading-relaxed text-amber-400">
            Da negativo: hay menos plata en el cajón que el sencillo con el que abriste. Revisa el
            conteo, o registra el retiro que falta en la pestaña Caja.
          </p>
        )}
      </Tarjeta>
    </div>
  );
}
