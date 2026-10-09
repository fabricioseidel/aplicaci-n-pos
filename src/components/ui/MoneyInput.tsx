"use client";

import React, { forwardRef } from "react";
import { formatMiles, parseCLP } from "@/lib/num";

interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Se llama con Enter (el teclado del teléfono muestra "Ir"). */
  onEnter?: () => void;
}

/**
 * Campo de pesos chilenos. Muestra "30.000" mientras se escribe y entrega el
 * número entero: "3.500" es tres mil quinientos, no 3,5 (ver `lib/num.ts`).
 * Al enfocarlo se selecciona todo, para que tipear reemplace en vez de
 * concatenar ("1003000000").
 *
 * `data-scan-guard`: si el lector de códigos dispara una ráfaga con el foco
 * acá, la ráfaga no se escribe en el monto (ver `useLaserScanner`).
 */
const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, onEnter, onFocus, onKeyDown, placeholder = "0", ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      data-scan-guard
      placeholder={placeholder}
      value={value === null ? "" : formatMiles(value)}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        onChange(digits ? parseCLP(digits) : null);
      }}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter) {
          e.preventDefault();
          onEnter();
        }
        onKeyDown?.(e);
      }}
      {...rest}
    />
  );
});

export default MoneyInput;
