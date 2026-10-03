"use client";

import React from "react";
import MoneyInput from "@/components/ui/MoneyInput";

/**
 * Campos compartidos por los pasos del cierre. Se centralizan para que los
 * cinco pasos se vean como una misma pantalla y no como cinco formularios.
 */

export function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-black uppercase tracking-widest text-white/30 mb-1.5">
      {children}
    </p>
  );
}

interface MontoProps {
  value: number | null;
  onChange: (v: number) => void;
  placeholder?: string;
  autoFocus?: boolean;
  "aria-label": string;
}

/**
 * Entrada de monto en pesos. Es un `MoneyInput`: "3.500" son tres mil
 * quinientos (con `type="number"` el punto era decimal y quedaba 3,5), se ve
 * con puntos mientras se escribe y se selecciona todo al tocarlo. Abre el
 * teclado numérico del celular.
 */
export function Monto({ value, onChange, placeholder, autoFocus, ...rest }: MontoProps) {
  return (
    <MoneyInput
      autoFocus={autoFocus}
      placeholder={placeholder ?? "0"}
      value={value === null || value === 0 ? null : value}
      onChange={(v) => onChange(v ?? 0)}
      className="w-full bg-black border border-white/10 rounded-xl px-3 h-12 text-right text-lg font-black text-white outline-none focus:border-emerald-500 tabular-nums"
      {...rest}
    />
  );
}

export function Texto({
  value,
  onChange,
  placeholder,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  "aria-label": string;
}) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-black border border-white/10 rounded-xl px-3 h-12 text-sm text-white outline-none focus:border-emerald-500"
      {...rest}
    />
  );
}

export function Tarjeta({
  titulo,
  accion,
  children,
}: {
  titulo?: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white/5 rounded-2xl border border-white/5 p-4 space-y-3">
      {(titulo || accion) && (
        <div className="flex items-center justify-between">
          {titulo && (
            <p className="text-[10px] font-black uppercase tracking-widest text-white/50">{titulo}</p>
          )}
          {accion}
        </div>
      )}
      {children}
    </div>
  );
}

export function FilaTotal({
  label,
  value,
  destacado,
}: {
  label: string;
  value: string;
  destacado?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={`text-[10px] font-black uppercase tracking-widest ${
          destacado ? "text-white" : "text-white/40"
        }`}
      >
        {label}
      </span>
      <span
        className={`font-black tabular-nums ${
          destacado ? "text-emerald-400 text-2xl" : "text-white text-base"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** Estado vacío de una lista. No es interactivo: sólo informa. */
export function Vacio({ children }: { children: React.ReactNode }) {
  return (
    <p className="w-full h-12 flex items-center justify-center rounded-xl border border-dashed border-white/15 text-[10px] font-black uppercase tracking-widest text-white/30">
      {children}
    </p>
  );
}
