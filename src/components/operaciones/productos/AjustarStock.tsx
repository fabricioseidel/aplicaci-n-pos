"use client";

import React, { useMemo, useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { ajustarStock } from "@/services/products";
import { newId } from "@/lib/offline/db";
import { parseCantidad } from "@/lib/num";
import { MOTIVOS_AJUSTE, type MotivoAjuste } from "@/lib/products/edicion";

/**
 * "Ajustar stock": cuántas hay AHORA en el local y por qué cambió.
 *
 * Reemplaza al campo stock editable de la ficha, que reenviaba el número de la
 * pantalla en cada guardado y revertía ventas. Acá la cantidad sólo se aplica
 * si el stock sigue siendo el que se veía, y el `opId` (creado al abrir) hace
 * que un reintento no lo aplique dos veces.
 */
export default function AjustarStock({
  barcode,
  nombre,
  porPeso,
  stockVisto: stockInicial,
  branchId,
  onCancel,
  onDone,
}: {
  barcode: string;
  nombre: string;
  porPeso: boolean;
  stockVisto: number;
  branchId: string | null;
  onCancel: () => void;
  onDone: (stock: number) => void;
}) {
  const opId = useMemo(() => newId(), []);
  const [stockVisto, setStockVisto] = useState(stockInicial);
  const [texto, setTexto] = useState("");
  const [motivo, setMotivo] = useState<MotivoAjuste | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cantidad = texto.trim() ? parseCantidad(texto) : null;
  const valida = cantidad !== null && cantidad >= 0 && (porPeso || Number.isInteger(cantidad));
  const diferencia = valida ? (cantidad as number) - stockVisto : 0;

  const enviar = async () => {
    if (!valida || !motivo || enviando) return;
    setEnviando(true);
    setError(null);
    const r = await ajustarStock({ barcode, stock: cantidad as number, stockVisto, motivo, opId, branchId }).catch(
      () => ({ ok: false as const, error: "Sin conexión: el ajuste no se hizo. Reintenta con red.", stockActual: undefined })
    );
    setEnviando(false);
    if (r.ok) {
      onDone(r.stock);
      return;
    }
    if (r.stockActual !== undefined) setStockVisto(Number(r.stockActual));
    setError(r.error);
  };

  return (
    <div className="fixed inset-0 z-[125] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
      <div className="w-full max-w-md bg-[#111] border border-white/10 rounded-3xl p-5 space-y-4 text-white">
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-emerald-400">Ajustar stock</p>
          <h2 className="text-lg font-black leading-snug">{nombre}</h2>
          <p className="text-sm text-white/50">
            El sistema dice <strong className="text-white">{stockVisto.toLocaleString("es-CL")}</strong>
            {porPeso ? " kg" : ""}.
          </p>
        </div>

        <div>
          <label className="block text-[11px] font-black uppercase tracking-widest text-white/45 mb-1">
            ¿Cuántas hay ahora?
          </label>
          <input
            autoFocus
            inputMode={porPeso ? "decimal" : "numeric"}
            data-scan-guard
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void enviar()}
            className="w-full bg-black border-2 border-white/20 rounded-2xl px-4 h-16 text-3xl font-black text-white outline-none focus:border-emerald-500 tabular-nums"
          />
          {valida && diferencia !== 0 && (
            <p className={`mt-1 text-sm font-bold ${diferencia < 0 ? "text-red-300" : "text-emerald-300"}`}>
              {diferencia > 0 ? "+" : ""}
              {diferencia.toLocaleString("es-CL")} {porPeso ? "kg" : "unidades"}
            </p>
          )}
        </div>

        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-white/45 mb-1">Motivo</p>
          <div className="grid grid-cols-2 gap-2">
            {MOTIVOS_AJUSTE.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={motivo === m}
                onClick={() => setMotivo(m)}
                className={`min-h-[3rem] px-2 rounded-xl border text-xs font-black ${
                  motivo === m ? "bg-emerald-500 border-emerald-400 text-black" : "bg-white/5 border-white/10 text-white/70"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm font-bold text-red-300">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-[3.25rem] rounded-2xl bg-white/5 text-white/60 text-xs font-black uppercase tracking-widest"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!valida || !motivo || enviando}
            className="flex-[2] min-h-[3.25rem] rounded-2xl bg-emerald-500 text-black text-xs font-black uppercase tracking-widest disabled:opacity-30 flex items-center justify-center gap-2"
          >
            {enviando && <ArrowPathIcon className="w-5 h-5 animate-spin" />}
            {!valida ? "Escribe la cantidad" : !motivo ? "Elige el motivo" : "Ajustar"}
          </button>
        </div>
      </div>
    </div>
  );
}
