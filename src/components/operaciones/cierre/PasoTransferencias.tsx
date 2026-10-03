"use client";

import React, { useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { clp } from "@/lib/cierre/denominations";
import { Etiqueta, Tarjeta, FilaTotal, Monto, Texto, Vacio } from "./campos";
import type { CierreDraft, TransferInput } from "./useCierreDraft";

/**
 * Transferencias recibidas, una por una.
 *
 * En el cuaderno se anotan en una columna y se suman a mano — que fue
 * justamente donde apareció el error de $1.400 del cierre del 10/09.
 */
/** Una transferencia que el POS registró como pago de una venta. */
export interface TransferenciaPOS {
  saleId: number;
  amount: number;
  reference?: string | null;
}

const notaDeVenta = (id: number) => `Venta #${id}`;

export default function PasoTransferencias({
  draft,
  patch,
  delPOS = [],
}: {
  draft: CierreDraft;
  patch: (c: Partial<CierreDraft>) => void;
  /** Transferencias de las ventas del turno, para no tipearlas de nuevo. */
  delPOS?: TransferenciaPOS[];
}) {
  const [monto, setMonto] = useState<number | null>(null);
  const [quien, setQuien] = useState("");

  const total = draft.transfers.reduce((a, t) => a + Number(t.amount), 0);

  const agregar = () => {
    if (!monto || monto <= 0) return;
    const nueva: TransferInput = { amount: monto, payer: quien.trim() || undefined };
    patch({ transfers: [...draft.transfers, nueva] });
    setMonto(null);
    setQuien("");
  };

  // Las que ya se trajeron quedan marcadas con "Venta #N" en la nota: traer
  // de nuevo sólo agrega las que faltan, nunca duplica.
  const yaTraidas = new Set(draft.transfers.map((t) => t.note).filter(Boolean));
  const porTraer = delPOS.filter((t) => !yaTraidas.has(notaDeVenta(t.saleId)));

  const traerDelPOS = () => {
    if (porTraer.length === 0) return;
    patch({
      transfers: [
        ...draft.transfers,
        ...porTraer.map((t) => ({
          amount: t.amount,
          payer: t.reference?.trim() || notaDeVenta(t.saleId),
          reference: t.reference ?? undefined,
          note: notaDeVenta(t.saleId),
        })),
      ],
    });
  };

  const quitar = (i: number) =>
    patch({ transfers: draft.transfers.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-4">
      {porTraer.length > 0 && (
        <button
          type="button"
          onClick={traerDelPOS}
          className="w-full min-h-14 rounded-2xl bg-white text-black font-black text-sm px-4 active:bg-white/80"
        >
          Traer {porTraer.length === 1 ? "la transferencia" : `las ${porTraer.length} transferencias`} del
          POS ({clp(porTraer.reduce((a, t) => a + t.amount, 0))})
        </button>
      )}

      <Tarjeta titulo="Agregar transferencia">
        <Monto aria-label="Monto de la transferencia" value={monto} onChange={setMonto} autoFocus />
        <Texto
          aria-label="De quién"
          value={quien}
          onChange={setQuien}
          placeholder="De quién (opcional)"
        />
        <button
          type="button"
          onClick={agregar}
          disabled={!monto || monto <= 0}
          className="w-full h-12 rounded-xl bg-emerald-500 text-black font-black uppercase tracking-widest text-xs disabled:opacity-30 active:bg-emerald-600 transition-colors"
        >
          Agregar
        </button>
      </Tarjeta>

      {draft.transfers.length === 0 ? (
        <Vacio>Todavía no hay transferencias</Vacio>
      ) : (
        <Tarjeta titulo={`Transferencias (${draft.transfers.length})`}>
          <div className="space-y-1.5">
            {draft.transfers.map((t, i) => (
              <div key={i} className="flex items-center gap-2 bg-black/40 rounded-xl px-3 h-12">
                <span className="text-[10px] font-black text-white/25 w-4 shrink-0">{i + 1}</span>
                <span className="flex-1 truncate text-sm text-white/60">{t.payer ?? "—"}</span>
                <span className="font-black text-white tabular-nums">{clp(t.amount)}</span>
                <button
                  type="button"
                  aria-label={`Quitar transferencia ${i + 1}`}
                  onClick={() => quitar(i)}
                  className="p-1.5 text-white/25 hover:text-red-400 shrink-0"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-white/10">
            <FilaTotal label="Total transferencias" value={clp(total)} destacado />
          </div>
        </Tarjeta>
      )}

      {draft.transfers.length === 0 && (
        <div className="px-1 text-[11px] leading-relaxed text-white/25">
          <Etiqueta>Por qué una por una</Etiqueta>
          Sumarlas a mano es donde se cuelan los errores. Cargadas por separado, el total lo calcula
          el sistema y siempre cuadra con el banco.
        </div>
      )}
    </div>
  );
}
