"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  BanknotesIcon, ArrowPathIcon, CreditCardIcon, UserGroupIcon,
  ClipboardDocumentCheckIcon, LockClosedIcon, PrinterIcon, CheckCircleIcon,
} from "@heroicons/react/24/outline";
import { useToast } from "@/contexts/ToastContext";
import { useBranch } from "@/contexts/BranchContext";
import type { CashShift } from "@/server/shifts.service";
import type { CierrePayload, CierreResumen } from "@/lib/cierre/types";
import { clp, businessDateToday } from "@/lib/cierre/denominations";
import { calcularPreview } from "@/lib/cierre/calc";
import { compartirCierre } from "@/lib/print/cierrePdf";
import { useCierreDraft } from "./cierre/useCierreDraft";
import PasoEfectivo from "./cierre/PasoEfectivo";
import PasoTransferencias from "./cierre/PasoTransferencias";
import PasoVouchers from "./cierre/PasoVouchers";
import PasoFiados from "./cierre/PasoFiados";
import PasoResumen from "./cierre/PasoResumen";
import { FilaTotal, Tarjeta } from "./cierre/campos";

const PASOS = [
  { id: "EFECTIVO", label: "Efectivo", icon: BanknotesIcon },
  { id: "TRANSFER", label: "Transf.", icon: ArrowPathIcon },
  { id: "TARJETA", label: "Tarjeta", icon: CreditCardIcon },
  { id: "FIADOS", label: "Fiados", icon: UserGroupIcon },
  { id: "RESUMEN", label: "Resumen", icon: ClipboardDocumentCheckIcon },
] as const;

type PasoId = (typeof PASOS)[number]["id"];

interface Movimiento {
  amount: number;
  type: "IN" | "OUT";
  method?: string;
}

/**
 * Cierre de caja declarado.
 *
 * El cierre anterior calculaba el "esperado" sumando las ventas que habían
 * pasado por el POS. Como el POS todavía no se usa para todas las ventas, ese
 * esperado daba cero y el día entero aparecía como descuadre — no había forma
 * de registrar lo que se anota en el cuaderno.
 *
 * Acá el cajero declara lo que hubo y eso queda como la verdad del día. Lo que
 * el POS sí registró se guarda aparte (`pos_totals`) para conciliar cuando el
 * inventario esté al día, sin bloquear el cierre mientras tanto.
 */
export default function CloseMode({ onShiftChange }: { onShiftChange?: () => void } = {}) {
  const { showToast } = useToast();
  const { currentBranch } = useBranch();

  const [shift, setShift] = useState<CashShift | null>(null);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [paso, setPaso] = useState<PasoId>("EFECTIVO");
  const [resultado, setResultado] = useState<CierreResumen | null>(null);

  const { draft, patch, clear, restored } = useCierreDraft(shift?.id ?? null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const url = currentBranch?.id
        ? `/api/caja/shifts?branchId=${encodeURIComponent(currentBranch.id)}`
        : "/api/caja/shifts";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const { shift: s } = (await res.json()) as { shift: CashShift | null };
      setShift(s);

      if (s?.id) {
        const mov = await fetch(`/api/caja?shiftId=${s.id}`, { cache: "no-store" });
        if (mov.ok) {
          const data = (await mov.json()) as { movements?: Movimiento[] };
          setMovimientos(data.movements ?? []);
        }
      }
    } catch {
      /* sin red no se puede saber si hay turno: se deja la pantalla como está */
    } finally {
      setLoading(false);
    }
  }, [currentBranch?.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Sólo los movimientos en efectivo mueven billetes en el cajón; uno por
  // transferencia no cambia lo que se cuenta al cerrar.
  const { ingresos, egresos } = useMemo(() => {
    const soloEfectivo = movimientos.filter((m) => (m.method ?? "CASH") === "CASH");
    return {
      ingresos: soloEfectivo.filter((m) => m.type === "IN").reduce((a, m) => a + Number(m.amount), 0),
      egresos: soloEfectivo.filter((m) => m.type === "OUT").reduce((a, m) => a + Number(m.amount), 0),
    };
  }, [movimientos]);

  const sencilloInicial = Number(shift?.starting_cash ?? 0);

  const preview = useMemo(
    () =>
      calcularPreview({
        denominations: draft.denominations,
        cashCounted: draft.cashCounted,
        transfers: draft.transfers,
        vouchers: draft.vouchers,
        abonos: draft.abonos,
        fiados: draft.fiados,
        sencilloInicial,
        ingresos,
        egresos,
      }),
    [draft, sencilloInicial, ingresos, egresos]
  );

  const registrar = async () => {
    if (!shift?.id || guardando) return;
    setGuardando(true);
    try {
      const payload: CierrePayload = {
        business_date: businessDateToday(),
        notes: draft.notes || undefined,
        denominations: Object.entries(draft.denominations)
          .map(([d, q]) => ({ denomination: Number(d), quantity: Number(q) }))
          .filter((d) => d.quantity > 0),
        cash_counted: draft.cashCounted ?? undefined,
        transfers: draft.transfers,
        vouchers: draft.vouchers,
        fiados: draft.fiados,
        abonos: draft.abonos,
      };

      const res = await fetch("/api/caja/cierre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId: shift.id, payload }),
      });
      const data = (await res.json()) as { resumen?: CierreResumen; error?: string };

      if (!res.ok || !data.resumen) {
        showToast(data.error ?? "No se pudo registrar el cierre", "error");
        return;
      }

      setResultado(data.resumen);
      clear();
      onShiftChange?.();
      showToast("Cierre registrado ✓", "success");
    } catch {
      // El cierre no se encola sin conexión a propósito: se arma sobre el
      // sencillo inicial y los movimientos del turno, y reenviarlo más tarde
      // contra un estado distinto daría un cierre equivocado sin avisar.
      showToast("Sin conexión. El borrador quedó guardado, reintenta al volver la red.", "warning");
    } finally {
      setGuardando(false);
    }
  };

  const imprimir = async (resumen: CierreResumen) => {
    try {
      const via = await compartirCierre(resumen);
      if (via === "downloaded") showToast("PDF descargado ✓", "success");
      if (via === "sin-plugins") {
        showToast(
          "PDF descargado. Para abrirlo directo en la impresora hay que actualizar la app.",
          "warning"
        );
      }
    } catch {
      showToast("No se pudo generar el PDF", "error");
    }
  };

  if (loading) {
    return (
      <div className="p-10 text-center text-white/40 text-xs font-black uppercase tracking-widest animate-pulse">
        Cargando…
      </div>
    );
  }

  // ── Cierre recién registrado ────────────────────────────────────────────
  if (resultado) {
    const t = resultado.shift.declared_totals;
    return (
      <div className="max-w-md mx-auto p-4 space-y-4">
        <div className="text-center py-6">
          <CheckCircleIcon className="w-14 h-14 text-emerald-400 mx-auto mb-3" />
          <h2 className="text-xl font-black">Caja cerrada</h2>
          <p className="text-white/40 text-xs mt-1">
            {resultado.branch ?? "Local"} · {resultado.shift.business_date}
          </p>
        </div>

        <Tarjeta>
          <FilaTotal label="Efectivo" value={clp(t?.CASH.ventas ?? 0)} />
          <FilaTotal label="Transferencia" value={clp(t?.TRANSFER.ventas ?? 0)} />
          <FilaTotal label="Tarjeta" value={clp(t?.CARD.ventas ?? 0)} />
          <div className="pt-3 border-t border-white/10">
            <FilaTotal label="Total ventas" value={clp(t?.total_ventas ?? 0)} destacado />
          </div>
        </Tarjeta>

        <button
          type="button"
          onClick={() => imprimir(resultado)}
          className="w-full h-14 rounded-2xl bg-white text-black font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 active:bg-white/80 transition-colors"
        >
          <PrinterIcon className="w-5 h-5" />
          Imprimir / compartir
        </button>

        <p className="text-center text-[11px] leading-relaxed text-white/30 px-4">
          Se genera un PDF de 58 mm. Elige tu app de impresión en el menú de compartir de Android.
        </p>

        <button
          type="button"
          onClick={() => {
            setResultado(null);
            void cargar();
          }}
          className="w-full text-[10px] font-black uppercase tracking-widest text-white/30 hover:text-white/60 py-3"
        >
          Volver
        </button>
      </div>
    );
  }

  // ── Sin turno abierto ───────────────────────────────────────────────────
  if (!shift) {
    return (
      <div className="max-w-sm mx-auto p-6 text-center">
        <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
          <LockClosedIcon className="h-8 w-8 text-white/30" />
        </div>
        <p className="text-white/40 text-sm font-bold">No hay turno abierto.</p>
        <p className="text-white/20 text-xs mt-1">Abre la caja del día en la pestaña Caja.</p>
      </div>
    );
  }

  const indice = PASOS.findIndex((p) => p.id === paso);
  const esUltimo = indice === PASOS.length - 1;

  return (
    <div className="max-w-2xl mx-auto pb-28">
      {/* Navegación de pasos */}
      <div className="sticky top-0 z-10 bg-[#0a0a0a] border-b border-white/5 px-1">
        <div className="flex">
          {PASOS.map(({ id, label, icon: Icon }, i) => (
            <button
              key={id}
              type="button"
              onClick={() => setPaso(id)}
              aria-current={paso === id ? "step" : undefined}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[8px] font-black uppercase tracking-widest border-b-2 transition-colors ${
                paso === id
                  ? "border-emerald-500 text-emerald-400"
                  : i < indice
                    ? "border-transparent text-white/40"
                    : "border-transparent text-white/20"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {restored && (
        <p className="mx-4 mt-3 rounded-xl bg-white/5 border border-white/10 p-3 text-[11px] leading-relaxed text-white/45">
          Recuperamos el cierre que habías empezado. Revisa que esté completo antes de registrarlo.
        </p>
      )}

      <div className="p-4">
        {paso === "EFECTIVO" && (
          <PasoEfectivo
            draft={draft}
            patch={patch}
            sencilloInicial={sencilloInicial}
            ingresos={ingresos}
            egresos={egresos}
          />
        )}
        {paso === "TRANSFER" && <PasoTransferencias draft={draft} patch={patch} />}
        {paso === "TARJETA" && <PasoVouchers draft={draft} patch={patch} />}
        {paso === "FIADOS" && <PasoFiados draft={draft} patch={patch} />}
        {paso === "RESUMEN" && (
          <PasoResumen
            draft={draft}
            patch={patch}
            preview={preview}
            fecha={businessDateToday()}
            local={currentBranch?.name ?? "Local"}
          />
        )}
      </div>

      {/* Barra fija: total corriendo + avance */}
      <div className="fixed bottom-0 inset-x-0 z-20 bg-[#0a0a0a]/95 backdrop-blur border-t border-white/10 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-white/30">
              Total del día
            </p>
            <p className="text-lg font-black text-emerald-400 tabular-nums truncate">
              {clp(preview.totalVentas)}
            </p>
          </div>

          {indice > 0 && (
            <button
              type="button"
              onClick={() => setPaso(PASOS[indice - 1].id)}
              className="h-12 px-4 rounded-xl bg-white/5 text-white/50 text-[10px] font-black uppercase tracking-widest shrink-0"
            >
              Atrás
            </button>
          )}

          {esUltimo ? (
            <button
              type="button"
              onClick={registrar}
              disabled={guardando}
              className="h-12 px-6 rounded-xl bg-emerald-500 text-black text-[10px] font-black uppercase tracking-widest shrink-0 disabled:opacity-40 flex items-center gap-2 active:bg-emerald-600 transition-colors"
            >
              {guardando && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
              Registrar cierre
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setPaso(PASOS[indice + 1].id)}
              className="h-12 px-6 rounded-xl bg-white text-black text-[10px] font-black uppercase tracking-widest shrink-0 active:bg-white/80 transition-colors"
            >
              Siguiente
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
