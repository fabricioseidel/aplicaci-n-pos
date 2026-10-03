"use client";

import React, { useState, useEffect } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { clp } from "@/lib/cierre/denominations";
import type { CustomerBalance } from "@/lib/cierre/types";
import { avisoAbono } from "@/lib/cierre/cuentas";
import { Etiqueta, Tarjeta, FilaTotal, Monto } from "./campos";
import SelectorCuenta, { type CuentaElegida } from "./SelectorCuenta";
import type { CierreDraft, AbonoInput, FiadoInput } from "./useCierreDraft";

const METODOS: Array<{ id: AbonoInput["method"]; label: string }> = [
  { id: "CASH", label: "Efectivo" },
  { id: "TRANSFER", label: "Transfer." },
  { id: "CARD", label: "Tarjeta" },
];

/**
 * Fiados: lo que se llevaron sin pagar y lo que vino a pagar alguien.
 *
 * Son dos cosas distintas y es clave no mezclarlas. Un cargo no es plata que
 * entra; un abono es plata que entra pero NO es venta de hoy. Si el abono no
 * se marca como tal, el día que Manuel paga su deuda ese día aparece como un
 * día de ventas altísimo que nunca existió.
 */
export default function PasoFiados({
  draft,
  patch,
}: {
  draft: CierreDraft;
  patch: (c: Partial<CierreDraft>) => void;
}) {
  const [cuentas, setCuentas] = useState<CustomerBalance[]>([]);
  const [cuentaFiado, setCuentaFiado] = useState<CuentaElegida | null>(null);
  const [montoFiado, setMontoFiado] = useState<number | null>(null);
  const [cuentaAbono, setCuentaAbono] = useState<CuentaElegida | null>(null);
  const [abonoMonto, setAbonoMonto] = useState<number | null>(null);
  // Pregunta pendiente antes de anotar un abono raro (ver avisoAbono).
  const [confirmarAbono, setConfirmarAbono] = useState<string | null>(null);
  const [abonoMetodo, setAbonoMetodo] = useState<AbonoInput["method"]>("CASH");

  useEffect(() => {
    fetch("/api/cuentas?todas=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { cuentas: [] }))
      .then((d: { cuentas?: CustomerBalance[] }) => setCuentas(d.cuentas ?? []))
      .catch(() => {
        /* sin red se puede seguir: el nombre se escribe igual y la cuenta se
           crea sola al registrar el cierre */
      });
  }, []);

  const totalFiado = draft.fiados.reduce((a, f) => a + Number(f.amount), 0);
  const totalAbonos = draft.abonos.reduce((a, f) => a + Number(f.amount), 0);
  const deudaVigente = cuentas.reduce((a, c) => a + Number(c.balance), 0);

  const agregarFiado = () => {
    if (!cuentaFiado || !montoFiado || montoFiado <= 0) return;
    const nuevo: FiadoInput = {
      name: cuentaFiado.name,
      amount: montoFiado,
      account_id: cuentaFiado.id,
    };
    patch({ fiados: [...draft.fiados, nuevo] });
    setCuentaFiado(null);
    setMontoFiado(null);
  };

  const agregarAbono = (confirmado = false) => {
    if (!cuentaAbono || !abonoMonto || abonoMonto <= 0) return;
    if (!confirmado) {
      const aviso = avisoAbono(cuentaAbono.balance, abonoMonto, cuentaAbono.name, clp);
      if (aviso) {
        setConfirmarAbono(aviso);
        return;
      }
    }
    const nuevo: AbonoInput = {
      name: cuentaAbono.name,
      amount: abonoMonto,
      method: abonoMetodo,
      account_id: cuentaAbono.id,
    };
    patch({ abonos: [...draft.abonos, nuevo] });
    setCuentaAbono(null);
    setAbonoMonto(null);
    setConfirmarAbono(null);
  };

  return (
    <div className="space-y-4">
      {/* ── Fiado nuevo ───────────────────────────────────────────────── */}
      <Tarjeta titulo="Se llevó fiado hoy">
        <SelectorCuenta
          cuentas={cuentas}
          valor={cuentaFiado}
          onChange={setCuentaFiado}
          etiqueta="Nombre de quien se lleva fiado"
        />
        <Monto
          aria-label="Monto fiado"
          value={montoFiado}
          onChange={setMontoFiado}
        />
        <button
          type="button"
          onClick={agregarFiado}
          disabled={!cuentaFiado || !montoFiado || montoFiado <= 0}
          className="w-full h-12 rounded-xl bg-amber-500 text-black font-black uppercase tracking-widest text-xs disabled:opacity-30 active:bg-amber-600 transition-colors"
        >
          Anotar fiado
        </button>

        {draft.fiados.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-white/10">
            {draft.fiados.map((f, i) => (
              <div key={i} className="flex items-center gap-2 bg-black/40 rounded-xl px-3 h-11">
                <span className="flex-1 truncate text-sm text-white/70">{f.name}</span>
                <span className="font-black text-amber-400 tabular-nums">{clp(f.amount)}</span>
                <button
                  type="button"
                  aria-label={`Quitar fiado de ${f.name}`}
                  onClick={() => patch({ fiados: draft.fiados.filter((_, x) => x !== i) })}
                  className="p-1 text-white/25 hover:text-red-400 shrink-0"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
            <FilaTotal label="Total fiado hoy" value={clp(totalFiado)} />
          </div>
        )}
      </Tarjeta>

      {/* ── Abonos ────────────────────────────────────────────────────── */}
      <Tarjeta titulo="Vino a pagar una deuda">
        <SelectorCuenta
          cuentas={cuentas}
          valor={cuentaAbono}
          onChange={(c) => {
            setCuentaAbono(c);
            setConfirmarAbono(null);
          }}
          etiqueta="Nombre de quien abona"
        />
        <Monto
          aria-label="Monto del abono"
          value={abonoMonto}
          onChange={(v) => {
            setAbonoMonto(v);
            setConfirmarAbono(null);
          }}
        />
        <div className="grid grid-cols-3 gap-2">
          {METODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setAbonoMetodo(m.id)}
              className={`h-12 rounded-xl text-xs font-black uppercase tracking-widest border transition-colors ${
                abonoMetodo === m.id
                  ? "bg-emerald-500 border-emerald-400 text-black"
                  : "bg-white/5 border-white/10 text-white/50"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {confirmarAbono && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
            <p className="text-sm text-amber-100">{confirmarAbono}</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirmarAbono(null)}
                className="h-12 rounded-xl bg-white/5 text-white/70 text-sm font-black uppercase"
              >
                Revisar
              </button>
              <button
                type="button"
                onClick={() => agregarAbono(true)}
                className="h-12 rounded-xl bg-amber-500 text-black text-sm font-black uppercase"
              >
                Sí, registrar
              </button>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => agregarAbono()}
          disabled={!cuentaAbono || !abonoMonto || abonoMonto <= 0 || !!confirmarAbono}
          className="w-full h-12 rounded-xl bg-emerald-500 text-black font-black uppercase tracking-widest text-xs disabled:opacity-30 active:bg-emerald-600 transition-colors"
        >
          Registrar abono
        </button>

        {draft.abonos.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-white/10">
            {draft.abonos.map((a, i) => (
              <div key={i} className="flex items-center gap-2 bg-black/40 rounded-xl px-3 h-11">
                <span className="flex-1 truncate text-sm text-white/70">
                  {a.name}
                  <span className="ml-1.5 text-[9px] uppercase tracking-widest text-white/25">
                    {METODOS.find((m) => m.id === a.method)?.label}
                  </span>
                </span>
                <span className="font-black text-emerald-400 tabular-nums">{clp(a.amount)}</span>
                <button
                  type="button"
                  aria-label={`Quitar abono de ${a.name}`}
                  onClick={() => patch({ abonos: draft.abonos.filter((_, x) => x !== i) })}
                  className="p-1 text-white/25 hover:text-red-400 shrink-0"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
            <FilaTotal label="Total abonos" value={clp(totalAbonos)} />
          </div>
        )}

        {draft.abonos.length > 0 && (
          <p className="text-[11px] leading-relaxed text-white/35">
            Los abonos se descuentan de las ventas del día: entró plata, pero la venta ya se contó
            el día en que se llevó la mercadería.
          </p>
        )}
      </Tarjeta>

      {cuentas.length > 0 && (
        <Tarjeta titulo="Deuda vigente">
          <div className="space-y-1">
            {cuentas
              .filter((c) => Number(c.balance) > 0)
              .map((c) => (
                <div key={c.id} className="flex justify-between text-sm">
                  <span className="text-white/50">{c.name}</span>
                  <span className="font-bold text-white/70 tabular-nums">{clp(c.balance)}</span>
                </div>
              ))}
          </div>
          <div className="pt-2 border-t border-white/10">
            <FilaTotal label="Total por cobrar" value={clp(deudaVigente)} />
          </div>
          <Etiqueta>Saldos antes de este cierre</Etiqueta>
        </Tarjeta>
      )}
    </div>
  );
}
