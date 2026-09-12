"use client";

import React, { useState } from "react";
import { TrashIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { clp } from "@/lib/cierre/denominations";
import { Etiqueta, Tarjeta, FilaTotal, Monto, Texto, Vacio } from "./campos";
import type { CierreDraft, VoucherInput } from "./useCierreDraft";

interface LineaVoucher {
  key: "credit" | "debit" | "prepaid";
  label: string;
}

const LINEAS: LineaVoucher[] = [
  { key: "credit", label: "Crédito" },
  { key: "debit", label: "Débito" },
  { key: "prepaid", label: "Prepago" },
];

const vacio = (): VoucherInput => ({
  terminal_code: "",
  credit_count: 0,
  credit_amount: 0,
  debit_count: 0,
  debit_amount: 0,
  prepaid_count: 0,
  prepaid_amount: 0,
  total_amount: 0,
});

const partes = (v: VoucherInput) =>
  Number(v.credit_amount || 0) +
  Number(v.debit_amount || 0) +
  Number(v.prepaid_amount || 0) +
  Number(v.cash_amount || 0);

/**
 * Cierres de terminal.
 *
 * Un día puede tener más de uno: si se vende después del cierre y se hace un
 * segundo cierre manual en la máquina, ese voucher entra acá en vez de sumarse
 * a mano al total de tarjeta — que es como hoy se pierde de vista.
 */
export default function PasoVouchers({
  draft,
  patch,
}: {
  draft: CierreDraft;
  patch: (c: Partial<CierreDraft>) => void;
}) {
  const [nuevo, setNuevo] = useState<VoucherInput>(vacio());

  const total = draft.vouchers.reduce((a, v) => a + Number(v.total_amount), 0);
  const descuadreNuevo = Number(nuevo.total_amount || 0) - partes(nuevo);

  const set = (campo: keyof VoucherInput, valor: number | string) =>
    setNuevo((v) => ({ ...v, [campo]: valor }));

  const agregar = () => {
    if (!nuevo.total_amount || nuevo.total_amount <= 0) return;
    patch({ vouchers: [...draft.vouchers, nuevo] });
    setNuevo(vacio());
  };

  const quitar = (i: number) =>
    patch({ vouchers: draft.vouchers.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-4">
      <Tarjeta titulo="Cargar un cierre de terminal">
        <Texto
          aria-label="Número de terminal"
          value={nuevo.terminal_code ?? ""}
          onChange={(v) => set("terminal_code", v)}
          placeholder="N° de terminal (ej: 20247378)"
        />

        {LINEAS.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[10px] font-black uppercase tracking-widest text-white/40">
              {label}
            </span>
            <input
              type="number"
              inputMode="numeric"
              aria-label={`Cantidad de ${label.toLowerCase()}`}
              data-laser-passthrough
              placeholder="cant"
              value={(nuevo[`${key}_count`] as number) || ""}
              onChange={(e) => set(`${key}_count`, Number(e.target.value) || 0)}
              className="w-16 shrink-0 bg-black border border-white/10 rounded-xl h-12 text-center font-black text-white outline-none focus:border-emerald-500 tabular-nums"
            />
            <div className="flex-1">
              <Monto
                aria-label={`Monto de ${label.toLowerCase()}`}
                value={(nuevo[`${key}_amount`] as number) || null}
                onChange={(v) => set(`${key}_amount`, v)}
              />
            </div>
          </div>
        ))}

        <div className="pt-2 border-t border-white/10 space-y-2">
          <Etiqueta>Total impreso en el voucher</Etiqueta>
          <Monto
            aria-label="Total impreso en el voucher"
            value={nuevo.total_amount || null}
            onChange={(v) => set("total_amount", v)}
          />
          {/* El total se pide aparte en vez de calcularlo: si no cuadra con las
              líneas, el voucher está mal leído y eso hay que verlo ahora. */}
          {Math.abs(descuadreNuevo) > 0 && partes(nuevo) > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3">
              <ExclamationTriangleIcon className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed text-amber-200">
                Las líneas suman {clp(partes(nuevo))} pero el total dice{" "}
                {clp(nuevo.total_amount)}. Diferencia de {clp(Math.abs(descuadreNuevo))} — revisa el
                papel antes de guardar.
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={agregar}
          disabled={!nuevo.total_amount || nuevo.total_amount <= 0}
          className="w-full h-12 rounded-xl bg-emerald-500 text-black font-black uppercase tracking-widest text-xs disabled:opacity-30 active:bg-emerald-600 transition-colors"
        >
          Agregar voucher
        </button>
      </Tarjeta>

      {draft.vouchers.length === 0 ? (
        <Vacio>Todavía no hay vouchers cargados</Vacio>
      ) : (
        <Tarjeta titulo={`Vouchers del día (${draft.vouchers.length})`}>
          <div className="space-y-2">
            {draft.vouchers.map((v, i) => {
              const desc = Number(v.total_amount) - partes(v);
              return (
                <div key={i} className="bg-black/40 rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-xs font-bold text-white/50">
                      Terminal {v.terminal_code || "—"}
                    </span>
                    <span className="font-black text-white tabular-nums">{clp(v.total_amount)}</span>
                    <button
                      type="button"
                      aria-label={`Quitar voucher ${i + 1}`}
                      onClick={() => quitar(i)}
                      className="p-1 text-white/25 hover:text-red-400 shrink-0"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/30 tabular-nums">
                    {Number(v.credit_amount) > 0 && <span>Créd {clp(v.credit_amount)}</span>}
                    {Number(v.debit_amount) > 0 && <span>Déb {clp(v.debit_amount)}</span>}
                    {Number(v.prepaid_amount) > 0 && <span>Prep {clp(v.prepaid_amount)}</span>}
                  </div>
                  {Math.abs(desc) > 0 && partes(v) > 0 && (
                    <p className="mt-1.5 text-[10px] font-bold text-amber-400">
                      Descuadre de {clp(Math.abs(desc))} entre las líneas y el total
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="pt-2 border-t border-white/10">
            <FilaTotal label="Total tarjeta" value={clp(total)} destacado />
          </div>
        </Tarjeta>
      )}
    </div>
  );
}
