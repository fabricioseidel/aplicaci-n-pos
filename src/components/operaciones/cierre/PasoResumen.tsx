"use client";

import React from "react";
import { clp } from "@/lib/cierre/denominations";
import type { PreviewCierre } from "@/lib/cierre/calc";
import type { FilaComparacion, MetodoComparado } from "@/lib/cierre/comparar";
import MoneyInput from "@/components/ui/MoneyInput";
import { Tarjeta, FilaTotal } from "./campos";
import type { CierreDraft } from "./useCierreDraft";

export interface CompraPorCobrar {
  id: number;
  seller_name?: string | null;
  total: number | string;
}

const COLOR: Record<FilaComparacion["estado"], string> = {
  cuadra: "text-emerald-400",
  faltan: "text-red-400",
  sobran: "text-amber-300",
};

export default function PasoResumen({
  draft,
  patch,
  preview,
  fecha,
  local,
  comparacion,
  comprasPersonal,
  onVolverAContar,
}: {
  draft: CierreDraft;
  patch: (c: Partial<CierreDraft>) => void;
  preview: PreviewCierre;
  fecha: string;
  local: string;
  /** null mientras no llegan las ventas del POS (o sin red). */
  comparacion: FilaComparacion[] | null;
  comprasPersonal: CompraPorCobrar[];
  onVolverAContar: (metodo: MetodoComparado) => void;
}) {
  const totalPorCobrar = comprasPersonal.reduce((a, c) => a + Number(c.total), 0);

  return (
    <div className="space-y-4">
      <Tarjeta titulo={`${local} · ${fecha}`}>
        <FilaTotal label="Efectivo" value={clp(preview.ventasEfectivo)} />
        <FilaTotal label="Transferencia" value={clp(preview.ventasTransferencia)} />
        <FilaTotal label="Tarjeta" value={clp(preview.ventasTarjeta)} />
        <div className="pt-3 border-t border-white/10">
          <FilaTotal label="Total ventas del día" value={clp(preview.totalVentas)} destacado />
        </div>
      </Tarjeta>

      {/* Se muestra recién acá, después de contar: si se viera antes, se
          cuenta "hacia" el número del POS en vez de contar lo que hay. */}
      {comparacion && (
        <Tarjeta titulo="Lo que registró el POS">
          <div className="space-y-3">
            {comparacion.map((f) => (
              <div key={f.metodo} className="rounded-xl bg-black/40 p-3 space-y-2">
                <p className="text-sm font-black text-white">{f.etiqueta}</p>
                <p className="text-sm text-white/70 leading-relaxed">
                  {f.metodo === "efectivo" ? "Según el POS debería haber " : "El POS registró "}
                  <span className="font-black text-white tabular-nums whitespace-nowrap">{clp(f.registro)}</span>
                  {f.metodo === "efectivo" ? "; contaste " : "; cargaste "}
                  <span className="font-black text-white tabular-nums whitespace-nowrap">{clp(f.declarado)}</span>
                </p>
                <div className="flex items-center gap-2">
                  <p className={`flex-1 text-lg font-black ${COLOR[f.estado]}`}>
                    {f.estado === "cuadra" ? "✓ Cuadra" : `→ ${f.texto[0].toUpperCase()}${f.texto.slice(1)}`}
                  </p>
                  {f.estado !== "cuadra" && (
                    <button
                      type="button"
                      onClick={() => onVolverAContar(f.metodo)}
                      className="h-12 px-4 rounded-xl bg-white/10 text-white text-xs font-black uppercase tracking-wider active:bg-white/20 shrink-0"
                    >
                      Volver a contar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-white/45">
            Es sólo para revisar: el cierre registra lo que contaste. Si alguna venta no pasó por
            el POS, la diferencia es esperable y no significa que falte plata.
          </p>
        </Tarjeta>
      )}

      <Tarjeta titulo="¿Cuánto dejas en la caja para mañana?">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-black text-white/30">$</span>
          <MoneyInput
            aria-label="Deja para mañana"
            placeholder="Sencillo que queda"
            value={draft.dejaParaManana}
            onChange={(v) => patch({ dejaParaManana: v })}
            className="w-full h-12 bg-black border border-white/10 rounded-xl pl-8 pr-3 text-right text-lg font-black text-white outline-none focus:border-emerald-500 tabular-nums"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => patch({ dejaParaManana: preview.contado })}
            className="min-h-12 rounded-xl bg-white/5 border border-white/10 text-sm font-bold text-white/70 active:bg-white/10"
          >
            Todo ({clp(preview.contado)})
          </button>
          <button
            type="button"
            onClick={() => patch({ dejaParaManana: 0 })}
            className="min-h-12 rounded-xl bg-white/5 border border-white/10 text-sm font-bold text-white/70 active:bg-white/10"
          >
            Nada ($ 0)
          </button>
        </div>
        <p className="text-xs leading-relaxed text-white/45">
          Es el efectivo con que se propone abrir la caja la próxima vez.
        </p>
      </Tarjeta>

      {comprasPersonal.length > 0 && (
        <Tarjeta titulo="Compras del personal por cobrar">
          {comprasPersonal.map((c) => (
            <div key={c.id} className="flex justify-between text-sm">
              <span className="text-white/70">{c.seller_name ?? "Sin dueño"}</span>
              <span className="font-bold text-amber-300 tabular-nums">{clp(c.total)}</span>
            </div>
          ))}
          <div className="pt-2 border-t border-white/10">
            <FilaTotal label="Total por cobrar" value={clp(totalPorCobrar)} />
          </div>
          <p className="text-xs leading-relaxed text-white/45">
            No entra plata a la caja: el dueño lo descuenta del sueldo.
          </p>
        </Tarjeta>
      )}

      {(preview.totalFiado > 0 || preview.totalAbonos > 0) && (
        <Tarjeta titulo="Fuera de las ventas">
          {preview.totalFiado > 0 && (
            <FilaTotal label="Fiado entregado hoy" value={clp(preview.totalFiado)} />
          )}
          {preview.totalAbonos > 0 && (
            <FilaTotal label="Abonos recibidos" value={clp(preview.totalAbonos)} />
          )}
          <p className="text-[11px] leading-relaxed text-white/35">
            El fiado no es venta hasta que se paga, y el abono no es venta de hoy. Por eso ninguno
            de los dos entra en el total de arriba.
          </p>
        </Tarjeta>
      )}

      <Tarjeta titulo="Observaciones">
        <textarea
          aria-label="Observaciones del cierre"
          rows={3}
          placeholder="Algo raro que valga la pena recordar…"
          value={draft.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          className="w-full bg-black border border-white/10 rounded-xl p-3 text-base text-white outline-none focus:border-emerald-500 resize-none"
        />
      </Tarjeta>
    </div>
  );
}
