"use client";

import React from "react";
import { clp } from "@/lib/cierre/denominations";
import type { PreviewCierre } from "@/lib/cierre/calc";
import { Tarjeta, FilaTotal } from "./campos";
import type { CierreDraft } from "./useCierreDraft";

export default function PasoResumen({
  draft,
  patch,
  preview,
  fecha,
  local,
}: {
  draft: CierreDraft;
  patch: (c: Partial<CierreDraft>) => void;
  preview: PreviewCierre;
  fecha: string;
  local: string;
}) {
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
          data-laser-passthrough
          rows={3}
          placeholder="Algo raro que valga la pena recordar…"
          value={draft.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          className="w-full bg-black border border-white/10 rounded-xl p-3 text-sm text-white outline-none focus:border-emerald-500 resize-none"
        />
      </Tarjeta>
    </div>
  );
}
