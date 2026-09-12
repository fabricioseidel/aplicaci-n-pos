"use client";

import React, { useState } from "react";
import {
  BanknotesIcon, LockClosedIcon, ClockIcon, UserGroupIcon,
} from "@heroicons/react/24/outline";
import CajaMode from "./CajaMode";
import CloseMode from "./CloseMode";
import HistorialMode from "./historial/HistorialMode";
import FiadosMode from "./historial/FiadosMode";

type Apartado = "TURNO" | "CIERRE" | "HISTORIAL" | "FIADOS";

const APARTADOS: { id: Apartado; label: string; icon: typeof BanknotesIcon }[] = [
  { id: "TURNO", label: "Turno", icon: BanknotesIcon },
  { id: "CIERRE", label: "Cierre", icon: LockClosedIcon },
  { id: "HISTORIAL", label: "Historial", icon: ClockIcon },
  { id: "FIADOS", label: "Fiados", icon: UserGroupIcon },
];

/**
 * Todo lo de caja en un solo lugar.
 *
 * Antes Caja y Cierre eran dos pestañas de primer nivel y no había forma de
 * mirar hacia atrás desde el celular: el historial y los fiados sólo existían
 * en el computador. Juntarlas libera espacio arriba (seis pestañas a 8px en un
 * teléfono ya no se leían) y deja el día completo a un toque de distancia.
 *
 * Los cuatro apartados leen las mismas tablas que `/admin/cierres` y
 * `/admin/fiados` en la web, a través de los mismos RPC. No hay copia local:
 * lo que se cierra en el mostrador se ve igual desde el computador, y lo que
 * se corrige en el computador se ve corregido acá.
 */
export default function CajaSection({ onShiftChange }: { onShiftChange?: () => void } = {}) {
  const [apartado, setApartado] = useState<Apartado>("TURNO");

  return (
    // Sin scroll propio: el contenedor de Operaciones ya scrollea. Anidar dos
    // áreas scrolleables en un teléfono deja la barra de pasos del cierre
    // fuera de alcance según dónde quedó el dedo.
    <div>
      <div className="sticky top-0 z-10 bg-[#0a0a0a] px-3 pt-3 pb-2">
        <div className="flex gap-1 rounded-2xl bg-white/5 p-1">
          {APARTADOS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setApartado(id)}
              aria-current={apartado === id ? "page" : undefined}
              className={`flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${
                apartado === id
                  ? "bg-emerald-500 text-black"
                  : "text-white/40 active:text-white/70"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        {apartado === "TURNO" && <CajaMode onShiftChange={onShiftChange} />}
        {apartado === "CIERRE" && <CloseMode onShiftChange={onShiftChange} />}
        {apartado === "HISTORIAL" && <HistorialMode />}
        {apartado === "FIADOS" && <FiadosMode />}
      </div>
    </div>
  );
}
