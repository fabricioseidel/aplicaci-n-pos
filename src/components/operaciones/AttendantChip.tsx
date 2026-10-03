"use client";

import React, { useState } from "react";
import { signOut } from "next-auth/react";
import { ArrowRightOnRectangleIcon, ChevronDownIcon, UserIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useAttendant } from "@/hooks/useAttendant";
import { useStaff, staffDisplayName } from "@/hooks/useStaff";
import { useSync } from "@/contexts/SyncContext";
import { usePOS } from "@/contexts/POSContext";
import { useToast } from "@/contexts/ToastContext";

/**
 * Chip "👤 Mariana ▾" arriba de las pestañas. Al tocarlo: nombres grandes
 * para cambiar de persona y, abajo, "Cerrar sesión". Si nadie se eligió
 * todavía, la hoja se abre sola al entrar.
 */
export default function AttendantChip() {
  const { attendant, ready, setAttendant } = useAttendant();
  const { staff } = useStaff();
  const { pending, syncNow } = useSync();
  const { cart, resetSale } = usePOS();
  const { showToast } = useToast();
  const [abierto, setAbierto] = useState(false);

  const mostrar = abierto || (ready && !attendant && staff.length > 0);

  const cerrarSesion = async () => {
    // Una venta sin sincronizar se enviaría con la sesión de otra persona, o
    // nunca: primero que se envíe.
    if (pending > 0) {
      showToast(`Hay ${pending} venta(s) sin enviar. Conéctate y sincroniza antes de salir.`, "error", 6000);
      void syncNow();
      return;
    }
    if (cart.length > 0 && !window.confirm("Hay una venta en curso. ¿Salir igual? Se borra el carrito.")) {
      return;
    }
    resetSale();
    setAttendant(null);
    await signOut({ callbackUrl: "/login" });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={`flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-black ${
          attendant ? "bg-white/5 border-white/10 text-white/80" : "bg-amber-500/15 border-amber-500/40 text-amber-300"
        }`}
      >
        <UserIcon className="h-3.5 w-3.5" />
        {attendant ? staffDisplayName(attendant.name) : "¿Quién atiende?"}
        <ChevronDownIcon className="h-3 w-3" />
      </button>

      {mostrar && (
        <div className="fixed inset-0 z-[130] bg-black/85 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl p-5 text-white space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">¿Quién atiende?</h2>
              {attendant && (
                <button type="button" onClick={() => setAbierto(false)} aria-label="Cerrar" className="p-2 -m-2 text-white/50">
                  <XMarkIcon className="h-6 w-6" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {staff.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setAttendant(s);
                    setAbierto(false);
                  }}
                  className={`h-14 rounded-xl border text-base font-black ${
                    attendant?.id === s.id
                      ? "bg-emerald-500 border-emerald-500 text-black"
                      : "bg-white/5 border-white/10 text-white"
                  }`}
                >
                  {staffDisplayName(s.name)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void cerrarSesion()}
              className="w-full h-12 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2"
            >
              <ArrowRightOnRectangleIcon className="h-5 w-5" /> Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </>
  );
}
