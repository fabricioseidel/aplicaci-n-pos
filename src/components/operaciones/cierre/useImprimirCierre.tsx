"use client";

import React, { useCallback, useRef, useState } from "react";
import { ArrowPathIcon, PrinterIcon, ShareIcon } from "@heroicons/react/24/outline";
import { useToast } from "@/contexts/ToastContext";
import type { CierreResumen } from "@/lib/cierre/types";
import { buildCierreLines } from "@/lib/print/cierreLines";
import { compartirCierre } from "@/lib/print/cierrePdf";
import {
  elegirImpresora,
  guardarImpresora,
  hayImpresoraBT,
  imprimirLineas,
  impresoraGuardada,
  listarVinculadas,
  mensajeErrorBT,
  type DispositivoBT,
} from "@/lib/print/impresoraBT";
import Hoja from "../caja/Hoja";

const codigoDe = (e: unknown) => (e as { code?: string } | null)?.code;

/**
 * Imprimir un cierre: directo en la térmica Bluetooth si el APK trae el
 * plugin, y si no, el PDF de 58 mm por el menú de compartir (como antes).
 *
 * La impresora se elige una sola vez: queda guardada en el teléfono y las
 * siguientes impresiones salen sin preguntar. `selector` es la hoja para
 * elegirla y hay que renderizarla en la pantalla que usa el hook.
 */
export function useImprimirCierre() {
  const { showToast } = useToast();
  const [eligiendo, setEligiendo] = useState<{ resumen: CierreResumen; vinculadas: DispositivoBT[] } | null>(null);
  const [imprimiendo, setImprimiendo] = useState(false);
  // El estado tarda un render en llegar al botón: el ref frena el segundo
  // toque de un doble toque, que si no imprimiría dos tickets.
  const ocupado = useRef(false);
  const conBluetooth = hayImpresoraBT();

  const compartirPdf = useCallback(
    async (resumen: CierreResumen) => {
      try {
        const via = await compartirCierre(resumen);
        if (via === "downloaded") showToast("PDF descargado ✓", "success");
        if (via === "sin-plugins") {
          showToast("PDF descargado. Para abrirlo directo en la impresora hay que actualizar la app.", "warning");
        }
      } catch {
        showToast("No se pudo generar el PDF", "error");
      }
    },
    [showToast]
  );

  const imprimirEn = useCallback(
    async (resumen: CierreResumen, impresora: DispositivoBT) => {
      setImprimiendo(true);
      try {
        await imprimirLineas(impresora.direccion, buildCierreLines(resumen));
        guardarImpresora(impresora);
        showToast(`Impreso en ${impresora.nombre ?? "la impresora"} ✓`, "success");
      } catch (e) {
        if (codigoDe(e) === "no-vinculada") guardarImpresora(null);
        showToast(mensajeErrorBT(codigoDe(e)), "error");
      } finally {
        setImprimiendo(false);
      }
    },
    [showToast]
  );

  const imprimir = useCallback(
    async (resumen: CierreResumen) => {
      if (!hayImpresoraBT()) return compartirPdf(resumen);
      if (ocupado.current) return;
      ocupado.current = true;
      try {
        let vinculadas: DispositivoBT[];
        try {
          vinculadas = await listarVinculadas();
        } catch (e) {
          showToast(mensajeErrorBT(codigoDe(e)), "error");
          return;
        }

        const impresora = elegirImpresora(vinculadas, impresoraGuardada());
        if (impresora) await imprimirEn(resumen, impresora);
        else setEligiendo({ resumen, vinculadas });
      } finally {
        ocupado.current = false;
      }
    },
    [compartirPdf, imprimirEn, showToast]
  );

  const selector = eligiendo && (
    <Hoja titulo="¿En qué impresora?" onClose={() => setEligiendo(null)}>
      {eligiendo.vinculadas.length === 0 ? (
        <p className="text-sm text-white/60 leading-relaxed">
          No hay nada vinculado por Bluetooth. Enciende la impresora y vincúlala en Ajustes → Bluetooth
          del teléfono; después vuelve a imprimir.
        </p>
      ) : (
        <div className="space-y-2">
          {eligiendo.vinculadas.map((d) => (
            <button
              key={d.direccion}
              type="button"
              onClick={() => {
                const { resumen } = eligiendo;
                setEligiendo(null);
                void imprimirEn(resumen, d);
              }}
              className="w-full min-h-14 px-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3 text-left active:bg-white/10"
            >
              <PrinterIcon className="w-5 h-5 shrink-0 text-white/50" />
              <span className="flex-1 min-w-0">
                <span className="block text-base font-black text-white truncate">{d.nombre ?? "Sin nombre"}</span>
                <span className="block text-xs text-white/35 tabular-nums">{d.direccion}</span>
              </span>
            </button>
          ))}
          <p className="text-xs text-white/40 leading-relaxed">
            Queda guardada: la próxima vez imprime directo.
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          const { resumen } = eligiendo;
          setEligiendo(null);
          void compartirPdf(resumen);
        }}
        className="w-full h-12 rounded-2xl bg-white/5 text-white/60 text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 active:bg-white/10"
      >
        <ShareIcon className="w-4 h-4" />
        Compartir PDF en vez de imprimir
      </button>
    </Hoja>
  );

  return { imprimir, compartirPdf, imprimiendo, conBluetooth, selector };
}

/** Ícono del botón de imprimir: gira mientras sale el ticket. */
export function IconoImprimir({ imprimiendo, className }: { imprimiendo: boolean; className: string }) {
  return imprimiendo ? (
    <ArrowPathIcon className={`${className} animate-spin`} />
  ) : (
    <PrinterIcon className={className} />
  );
}
