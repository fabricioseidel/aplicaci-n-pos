"use client";

import React, { useState } from "react";
import { clp } from "@/lib/cierre/denominations";
import { buscarCuentas, cuentaExacta } from "@/lib/cierre/cuentas";
import type { CustomerBalance } from "@/lib/cierre/types";

/** Cuenta elegida: una existente (con id) o una nueva confirmada (sin id). */
export interface CuentaElegida {
  id: string | null;
  name: string;
  /** Deuda actual; null si es nueva. */
  balance: number | null;
}

/**
 * Elegir a quién se le fía (o quién abona) de una lista con búsqueda.
 *
 * Escribir "don pedro" muestra "Don Pedro (vecino) · debe $3.500" para
 * tocarlo. Crear una cuenta nueva es un paso aparte y explícito ("+ Nueva
 * cuenta"), con las parecidas a la vista: así no se parte una deuda en dos
 * cuentas por escribir el nombre distinto (#12).
 */
export default function SelectorCuenta({
  cuentas,
  valor,
  onChange,
  etiqueta,
}: {
  cuentas: CustomerBalance[];
  valor: CuentaElegida | null;
  onChange: (c: CuentaElegida | null) => void;
  etiqueta: string;
}) {
  const [texto, setTexto] = useState("");
  const [confirmarNueva, setConfirmarNueva] = useState(false);

  if (valor) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-black/40 border border-white/10 px-3 min-h-14">
        <div className="flex-1 min-w-0">
          <p className="text-base font-black text-white truncate">{valor.name}</p>
          <p className={`text-sm ${valor.balance && valor.balance > 0 ? "text-amber-300" : "text-white/45"}`}>
            {valor.id === null
              ? "Cuenta nueva"
              : valor.balance && valor.balance > 0
                ? `Debe ${clp(valor.balance)}`
                : "No debe nada"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setTexto("");
          }}
          className="h-12 px-3 rounded-xl bg-white/5 text-white/70 text-xs font-black uppercase tracking-wider shrink-0 active:bg-white/10"
        >
          Cambiar
        </button>
      </div>
    );
  }

  const nombre = texto.trim();
  const sugeridas = buscarCuentas(cuentas, nombre);
  const exacta = cuentaExacta(cuentas, nombre);
  const elegir = (c: CustomerBalance) =>
    onChange({ id: c.id, name: c.name, balance: Number(c.balance) });

  return (
    <div className="space-y-2">
      <input
        type="text"
        aria-label={etiqueta}
        placeholder="Buscar nombre…"
        autoComplete="off"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setConfirmarNueva(false);
        }}
        className="w-full bg-black border border-white/10 rounded-xl px-3 h-12 text-base text-white outline-none focus:border-emerald-500"
      />

      {nombre && !confirmarNueva && (
        <div className="space-y-1.5">
          {sugeridas.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => elegir(c)}
              className="w-full min-h-12 flex items-center justify-between gap-2 rounded-xl bg-white/5 border border-white/10 px-3 text-left active:bg-white/10"
            >
              <span className="text-base text-white truncate">{c.name}</span>
              <span className={`text-sm shrink-0 ${Number(c.balance) > 0 ? "text-amber-300" : "text-white/40"}`}>
                {Number(c.balance) > 0 ? `debe ${clp(c.balance)}` : "no debe"}
              </span>
            </button>
          ))}
          {!exacta && (
            <button
              type="button"
              onClick={() => setConfirmarNueva(true)}
              className="w-full min-h-12 rounded-xl border border-dashed border-white/20 px-3 text-left text-base text-white/70 active:bg-white/5"
            >
              + Nueva cuenta: &quot;{nombre}&quot;
            </button>
          )}
        </div>
      )}

      {confirmarNueva && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
          <p className="text-sm text-amber-100">
            ¿Crear una cuenta nueva a nombre de <span className="font-black">&quot;{nombre}&quot;</span>?
          </p>
          {sugeridas.length > 0 && (
            <>
              <p className="text-sm text-amber-100/80">¿No será una de estas?</p>
              {sugeridas.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => elegir(c)}
                  className="w-full min-h-12 rounded-xl bg-white/10 px-3 text-left text-base font-bold text-white active:bg-white/20"
                >
                  Es {c.name}
                </button>
              ))}
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirmarNueva(false)}
              className="h-12 rounded-xl bg-white/5 text-white/70 text-sm font-black uppercase"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={() => onChange({ id: null, name: nombre, balance: null })}
              className="h-12 rounded-xl bg-amber-500 text-black text-sm font-black uppercase"
            >
              Sí, crear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
