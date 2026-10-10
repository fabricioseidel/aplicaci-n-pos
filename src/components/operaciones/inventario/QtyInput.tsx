"use client";

import React, { useEffect, useState } from "react";
import { cantidadDesdeTexto } from "@/lib/inventario/recepcion";

interface QtyInputProps {
  value: number;
  onChange: (value: number) => void;
  /** Por peso acepta decimales ("1,5"); por unidad solo enteros. */
  porPeso?: boolean;
  /** Acepta 0 ("no hay ninguno", en el Conteo). */
  permitirCero?: boolean;
  "aria-label": string;
  className?: string;
}

/**
 * Cantidad tipeable: 24 unidades son un toque y "24", no 23 toques en "+".
 * Se escribe libre y se aplica al salir del campo o con Enter; si lo escrito
 * no es una cantidad válida, vuelve al valor anterior. Al enfocarlo se
 * selecciona todo, para que tipear reemplace en vez de concatenar.
 *
 * `data-scan-guard`: una lectura del láser con el foco acá no se escribe como
 * cantidad (ver `useLaserScanner`).
 */
export default function QtyInput({
  value,
  onChange,
  porPeso = false,
  permitirCero = false,
  className,
  ...rest
}: QtyInputProps) {
  const mostrar = (n: number) => (porPeso ? String(Math.round(n * 1000) / 1000).replace(".", ",") : String(n));
  const [texto, setTexto] = useState(mostrar(value));
  const [editando, setEditando] = useState(false);

  useEffect(() => {
    if (!editando) setTexto(mostrar(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mostrar` depende solo de porPeso
  }, [value, editando, porPeso]);

  const aplicar = () => {
    setEditando(false);
    const limpio = texto.trim();
    if (permitirCero && /^0+([.,]0*)?$/.test(limpio)) {
      if (value !== 0) onChange(0);
      setTexto(mostrar(0));
      return;
    }
    const n = cantidadDesdeTexto(limpio, porPeso);
    if (n === null) {
      setTexto(mostrar(value));
      return;
    }
    if (n !== value) onChange(n);
    setTexto(mostrar(n));
  };

  return (
    <input
      type="text"
      inputMode={porPeso ? "decimal" : "numeric"}
      autoComplete="off"
      data-scan-guard
      value={texto}
      onFocus={(e) => {
        setEditando(true);
        e.currentTarget.select();
      }}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={aplicar}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={className}
      {...rest}
    />
  );
}
