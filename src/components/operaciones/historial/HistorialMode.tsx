"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ChevronLeftIcon, ChevronRightIcon, PrinterIcon, ArrowPathIcon,
  ExclamationTriangleIcon, XMarkIcon,
} from "@heroicons/react/24/outline";
import { useToast } from "@/contexts/ToastContext";
import { useBranch } from "@/contexts/BranchContext";
import { clp } from "@/lib/cierre/denominations";
import { compartirCierre } from "@/lib/print/cierrePdf";
import type { CierreResumen, DeclaredTotals } from "@/lib/cierre/types";
import { Tarjeta, FilaTotal, Vacio } from "../cierre/campos";

interface CierreFila {
  id: string;
  business_date: string;
  branch_id: string | null;
  starting_cash: number;
  actual_cash: number | null;
  notes: string | null;
  declared_totals: DeclaredTotals | null;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** El día se parte a mano: `new Date("2026-09-10")` es UTC y en Chile retrocede uno. */
function etiquetaDia(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} ${DIAS[new Date(y, m - 1, d).getDay()]}`;
}

const rangoDelMes = (anio: number, mes: number) => {
  const mm = String(mes).padStart(2, "0");
  return { desde: `${anio}-${mm}-01`, hasta: `${anio}-${mm}-${new Date(anio, mes, 0).getDate()}` };
};

/**
 * Historial de cierres en el celular.
 *
 * Lee exactamente las mismas tablas que `/admin/cierres` en la web, a través
 * del mismo `resumen_cierre`: un cierre hecho en el mostrador se ve igual desde
 * el computador, y uno corregido en el computador se ve corregido acá. No hay
 * copia local que se pueda desincronizar.
 */
export default function HistorialMode() {
  const { showToast } = useToast();
  const { currentBranch, branches } = useBranch();

  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [soloEsteLocal, setSoloEsteLocal] = useState(true);
  const [cierres, setCierres] = useState<CierreFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [detalle, setDetalle] = useState<CierreResumen | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const { desde, hasta } = rangoDelMes(anio, mes);
      const params = new URLSearchParams({ desde, hasta });
      if (soloEsteLocal && currentBranch?.id) params.set("branchId", currentBranch.id);

      const res = await fetch(`/api/caja/cierre?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { cierres?: CierreFila[] };
      // El servidor los devuelve del más antiguo al más nuevo; en el celular
      // interesa primero lo de ayer, no lo del día 1.
      setCierres((data.cierres ?? []).slice().reverse());
    } catch {
      showToast("No se pudo cargar el historial", "error");
    } finally {
      setLoading(false);
    }
  }, [anio, mes, soloEsteLocal, currentBranch?.id, showToast]);

  useEffect(() => { void cargar(); }, [cargar]);

  const totales = useMemo(() => {
    const de = (c: CierreFila, k: "CASH" | "TRANSFER" | "CARD") =>
      Number(c.declared_totals?.[k]?.ventas ?? 0);
    return {
      efectivo: cierres.reduce((a, c) => a + de(c, "CASH"), 0),
      transferencia: cierres.reduce((a, c) => a + de(c, "TRANSFER"), 0),
      tarjeta: cierres.reduce((a, c) => a + de(c, "CARD"), 0),
      ventas: cierres.reduce((a, c) => a + Number(c.declared_totals?.total_ventas ?? 0), 0),
      fiado: cierres.reduce((a, c) => a + Number(c.declared_totals?.fiados_otorgados ?? 0), 0),
    };
  }, [cierres]);

  const cambiarMes = (delta: number) => {
    const d = new Date(anio, mes - 1 + delta, 1);
    setAnio(d.getFullYear());
    setMes(d.getMonth() + 1);
  };

  const abrir = async (id: string) => {
    setAbriendo(id);
    try {
      const res = await fetch(`/api/caja/cierre?shiftId=${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setDetalle((await res.json()).resumen);
    } catch {
      showToast("No se pudo abrir el cierre", "error");
    } finally {
      setAbriendo(null);
    }
  };

  const nombreLocal = (id: string | null) => branches.find((b) => b.id === id)?.name ?? "—";

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      {/* Mes */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => cambiarMes(-1)}
          aria-label="Mes anterior"
          className="w-11 h-11 shrink-0 rounded-xl bg-white/5 text-white/50 flex items-center justify-center active:bg-white/10"
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <p className="flex-1 text-center text-sm font-black uppercase tracking-widest text-white">
          {MESES[mes - 1]} {anio}
        </p>
        <button
          type="button"
          onClick={() => cambiarMes(1)}
          aria-label="Mes siguiente"
          className="w-11 h-11 shrink-0 rounded-xl bg-white/5 text-white/50 flex items-center justify-center active:bg-white/10"
        >
          <ChevronRightIcon className="w-5 h-5" />
        </button>
      </div>

      {branches.length > 1 && (
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: true, label: currentBranch?.name ?? "Este local" },
            { id: false, label: "Todos" },
          ].map((o) => (
            <button
              key={String(o.id)}
              type="button"
              onClick={() => setSoloEsteLocal(o.id)}
              className={`h-10 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${
                soloEsteLocal === o.id
                  ? "bg-emerald-500 border-emerald-400 text-black"
                  : "bg-white/5 border-white/10 text-white/50"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {/* Totales del mes */}
      <Tarjeta titulo={`${cierres.length} día(s) con cierre`}>
        <FilaTotal label="Efectivo" value={clp(totales.efectivo)} />
        <FilaTotal label="Transferencia" value={clp(totales.transferencia)} />
        <FilaTotal label="Tarjeta" value={clp(totales.tarjeta)} />
        <div className="pt-2 border-t border-white/10">
          <FilaTotal label="Ventas del mes" value={clp(totales.ventas)} destacado />
        </div>
        {totales.fiado > 0 && (
          <p className="text-[11px] text-amber-400/80">
            Además se entregaron {clp(totales.fiado)} en fiado, que no son venta hasta que se paguen.
          </p>
        )}
      </Tarjeta>

      {/* Días */}
      {loading ? (
        <p className="py-10 text-center text-white/30 text-xs font-black uppercase tracking-widest animate-pulse">
          Cargando…
        </p>
      ) : cierres.length === 0 ? (
        <Vacio>Sin cierres este mes</Vacio>
      ) : (
        <div className="space-y-2">
          {cierres.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => void abrir(c.id)}
              className="w-full text-left bg-white/5 rounded-2xl border border-white/5 p-4 active:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-white">{etiquetaDia(c.business_date)}</span>
                {branches.length > 1 && (
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/25">
                    {nombreLocal(c.branch_id)}
                  </span>
                )}
                <span className="flex-1" />
                {abriendo === c.id ? (
                  <ArrowPathIcon className="w-4 h-4 text-white/30 animate-spin" />
                ) : (
                  <span className="text-lg font-black text-emerald-400 tabular-nums">
                    {clp(c.declared_totals?.total_ventas ?? 0)}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-white/30 tabular-nums">
                <span>Efec {clp(c.declared_totals?.CASH?.ventas ?? 0)}</span>
                <span>Transf {clp(c.declared_totals?.TRANSFER?.ventas ?? 0)}</span>
                <span>Tarj {clp(c.declared_totals?.CARD?.ventas ?? 0)}</span>
                {Number(c.declared_totals?.fiados_otorgados ?? 0) > 0 && (
                  <span className="text-amber-400/70">
                    Fiado {clp(c.declared_totals?.fiados_otorgados)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {detalle && (
        <DetalleCierre
          resumen={detalle}
          onClose={() => setDetalle(null)}
          onImprimir={async () => {
            try {
              const via = await compartirCierre(detalle);
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
          }}
        />
      )}
    </div>
  );
}

// ── Detalle de un día ──────────────────────────────────────────────────────
function DetalleCierre({
  resumen,
  onClose,
  onImprimir,
}: {
  resumen: CierreResumen;
  onClose: () => void;
  onImprimir: () => void;
}) {
  const t = resumen.shift.declared_totals;
  const cargos = resumen.account_entries.filter((e) => e.kind === "CHARGE");
  const abonos = resumen.account_entries.filter((e) => e.kind === "PAYMENT");
  const pos = resumen.shift.pos_totals ?? {};

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={onClose}>
      <div
        className="w-full max-h-[90vh] overflow-y-auto rounded-t-3xl bg-[#0a0a0a] border-t border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-[#0a0a0a] border-b border-white/5 px-4 py-3 flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-white/30">
              {resumen.branch ?? "Local"}
            </p>
            <p className="text-base font-black text-white">{etiquetaDia(resumen.shift.business_date)}</p>
          </div>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onImprimir}
            aria-label="Imprimir este cierre"
            className="h-10 px-4 rounded-xl bg-white text-black text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 active:bg-white/80"
          >
            <PrinterIcon className="w-4 h-4" />
            Imprimir
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-10 h-10 shrink-0 rounded-xl bg-white/5 text-white/40 flex items-center justify-center"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <Tarjeta>
            <FilaTotal label="Efectivo" value={clp(t?.CASH.ventas ?? 0)} />
            <FilaTotal label="Transferencia" value={clp(t?.TRANSFER.ventas ?? 0)} />
            <FilaTotal label="Tarjeta" value={clp(t?.CARD.ventas ?? 0)} />
            <div className="pt-2 border-t border-white/10">
              <FilaTotal label="Total ventas" value={clp(t?.total_ventas ?? 0)} destacado />
            </div>
          </Tarjeta>

          <Tarjeta titulo="Efectivo">
            <FilaTotal label="Sencillo inicial" value={clp(resumen.shift.starting_cash)} />
            <FilaTotal label="Contado en caja" value={clp(resumen.shift.actual_cash ?? 0)} />
            {resumen.denominations.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {resumen.denominations.map((d) => (
                  <span
                    key={d.denomination}
                    className="rounded-lg bg-black/40 px-2 py-1 text-[10px] text-white/40 tabular-nums"
                  >
                    {d.denomination.toLocaleString("es-CL")} × {d.quantity}
                  </span>
                ))}
              </div>
            )}
          </Tarjeta>

          {resumen.transfers.length > 0 && (
            <Tarjeta titulo={`Transferencias (${resumen.transfers.length})`}>
              {resumen.transfers.map((tr, i) => (
                <div key={tr.id} className="flex justify-between text-sm">
                  <span className="text-white/40 truncate mr-2">{tr.payer || `#${i + 1}`}</span>
                  <span className="font-bold text-white tabular-nums">{clp(tr.amount)}</span>
                </div>
              ))}
            </Tarjeta>
          )}

          {resumen.vouchers.length > 0 && (
            <Tarjeta titulo={`Vouchers (${resumen.vouchers.length})`}>
              {resumen.vouchers.map((v) => {
                const desc = Number(v.total_amount) - Number(v.parts_total);
                return (
                  <div key={v.id} className="bg-black/40 rounded-xl p-3">
                    <div className="flex justify-between">
                      <span className="text-xs text-white/40">Terminal {v.terminal_code || "—"}</span>
                      <span className="font-black text-white tabular-nums">{clp(v.total_amount)}</span>
                    </div>
                    {Number(v.parts_total) > 0 && (
                      <p className="mt-1 text-[10px] text-white/25 tabular-nums">
                        Créd {clp(v.credit_amount)} · Déb {clp(v.debit_amount)} · Prep{" "}
                        {clp(v.prepaid_amount)}
                      </p>
                    )}
                    {Number(v.parts_total) > 0 && Math.abs(desc) > 0.5 && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold text-amber-400">
                        <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                        Descuadre de {clp(Math.abs(desc))} entre las líneas y el total
                      </p>
                    )}
                  </div>
                );
              })}
            </Tarjeta>
          )}

          {cargos.length > 0 && (
            <Tarjeta titulo="Fiado entregado">
              {cargos.map((c) => (
                <div key={c.id} className="flex justify-between text-sm">
                  <span className="text-white/40">{c.name}</span>
                  <span className="font-bold text-amber-400 tabular-nums">{clp(c.amount)}</span>
                </div>
              ))}
            </Tarjeta>
          )}

          {abonos.length > 0 && (
            <Tarjeta titulo="Abonos recibidos">
              {abonos.map((a) => (
                <div key={a.id} className="flex justify-between text-sm">
                  <span className="text-white/40">{a.name}</span>
                  <span className="font-bold text-emerald-400 tabular-nums">{clp(a.amount)}</span>
                </div>
              ))}
            </Tarjeta>
          )}

          {resumen.shift.notes && (
            <Tarjeta titulo="Observaciones">
              <p className="text-sm text-white/50 leading-relaxed">{resumen.shift.notes}</p>
            </Tarjeta>
          )}

          {Object.keys(pos).length > 0 && (
            <Tarjeta titulo="Lo que registró el POS">
              {Object.entries(pos).map(([metodo, monto]) => (
                <div key={metodo} className="flex justify-between text-sm">
                  <span className="text-white/40">{metodo}</span>
                  <span className="font-bold text-white tabular-nums">{clp(monto)}</span>
                </div>
              ))}
              <p className="text-[11px] leading-relaxed text-white/30">
                Comparación contra lo declarado. Mientras el POS no registre todas las ventas, la
                diferencia es esperable y no significa que falte plata.
              </p>
            </Tarjeta>
          )}
        </div>
      </div>
    </div>
  );
}
