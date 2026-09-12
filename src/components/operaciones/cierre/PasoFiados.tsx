"use client";

import React, { useState, useEffect } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { clp } from "@/lib/cierre/denominations";
import type { CustomerBalance } from "@/lib/cierre/types";
import { Etiqueta, Tarjeta, FilaTotal, Monto } from "./campos";
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
  const [nombre, setNombre] = useState("");
  const [montoFiado, setMontoFiado] = useState<number | null>(null);
  const [abonoNombre, setAbonoNombre] = useState("");
  const [abonoMonto, setAbonoMonto] = useState<number | null>(null);
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

  const buscarCuenta = (n: string) =>
    cuentas.find((c) => c.name.trim().toLowerCase() === n.trim().toLowerCase());

  const totalFiado = draft.fiados.reduce((a, f) => a + Number(f.amount), 0);
  const totalAbonos = draft.abonos.reduce((a, f) => a + Number(f.amount), 0);
  const deudaVigente = cuentas.reduce((a, c) => a + Number(c.balance), 0);

  const agregarFiado = () => {
    if (!nombre.trim() || !montoFiado || montoFiado <= 0) return;
    const cuenta = buscarCuenta(nombre);
    const nuevo: FiadoInput = {
      name: nombre.trim(),
      amount: montoFiado,
      account_id: cuenta?.id ?? null,
    };
    patch({ fiados: [...draft.fiados, nuevo] });
    setNombre("");
    setMontoFiado(null);
  };

  const agregarAbono = () => {
    if (!abonoNombre.trim() || !abonoMonto || abonoMonto <= 0) return;
    const cuenta = buscarCuenta(abonoNombre);
    const nuevo: AbonoInput = {
      name: abonoNombre.trim(),
      amount: abonoMonto,
      method: abonoMetodo,
      account_id: cuenta?.id ?? null,
    };
    patch({ abonos: [...draft.abonos, nuevo] });
    setAbonoNombre("");
    setAbonoMonto(null);
  };

  return (
    <div className="space-y-4">
      <datalist id="cuentas-fiado">
        {cuentas.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>

      {/* ── Fiado nuevo ───────────────────────────────────────────────── */}
      <Tarjeta titulo="Se llevó fiado hoy">
        <div className="relative">
          <input
            type="text"
            list="cuentas-fiado"
            aria-label="Nombre de quien se lleva fiado"
            data-laser-passthrough
            placeholder="Nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full bg-black border border-white/10 rounded-xl px-3 h-12 text-sm text-white outline-none focus:border-emerald-500"
          />
        </div>
        {nombre.trim() && buscarCuenta(nombre) && (
          <p className="text-[10px] font-bold text-amber-400">
            Ya debe {clp(buscarCuenta(nombre)!.balance)}
          </p>
        )}
        <Monto
          aria-label="Monto fiado"
          value={montoFiado}
          onChange={setMontoFiado}
        />
        <button
          type="button"
          onClick={agregarFiado}
          disabled={!nombre.trim() || !montoFiado || montoFiado <= 0}
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
        <input
          type="text"
          list="cuentas-fiado"
          aria-label="Nombre de quien abona"
          data-laser-passthrough
          placeholder="Nombre"
          value={abonoNombre}
          onChange={(e) => setAbonoNombre(e.target.value)}
          className="w-full bg-black border border-white/10 rounded-xl px-3 h-12 text-sm text-white outline-none focus:border-emerald-500"
        />
        {abonoNombre.trim() && buscarCuenta(abonoNombre) && (
          <p className="text-[10px] font-bold text-white/40">
            Debe {clp(buscarCuenta(abonoNombre)!.balance)}
          </p>
        )}
        <Monto aria-label="Monto del abono" value={abonoMonto} onChange={setAbonoMonto} />
        <div className="grid grid-cols-3 gap-2">
          {METODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setAbonoMetodo(m.id)}
              className={`h-10 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${
                abonoMetodo === m.id
                  ? "bg-emerald-500 border-emerald-400 text-black"
                  : "bg-white/5 border-white/10 text-white/50"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={agregarAbono}
          disabled={!abonoNombre.trim() || !abonoMonto || abonoMonto <= 0}
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
