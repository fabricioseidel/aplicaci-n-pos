"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { createScanDetector } from "@/lib/scan/detector";
import { useToast } from "@/contexts/ToastContext";

type ScanHandler = (code: string) => void;

interface ScanContextValue {
  register: (handler: { current: ScanHandler }) => () => void;
  ok: () => void;
  error: () => void;
}

const ScanContext = createContext<ScanContextValue | null>(null);

const isEditable = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

/** Cambia el valor de un input controlado por React y le avisa (dispara onChange). */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

let audio: AudioContext | null = null;
function beep(freq: number, ms: number, times = 1) {
  try {
    audio ??= new AudioContext();
    for (let i = 0; i < times; i++) {
      const start = audio.currentTime + i * (ms / 1000 + 0.06);
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + ms / 1000);
    }
  } catch {
    /* sin audio: queda la vibración */
  }
}

/**
 * Único dueño del lector láser en toda la app.
 *
 * Antes cada pantalla escuchaba por su cuenta (y Venta no escuchaba): el
 * láser sólo funcionaba con el modal de cámara abierto, el Enter del lector
 * "presionaba" la tarjeta que había quedado con foco (se cobraba el producto
 * anterior) y los dígitos se escribían en el campo enfocado — un código en el
 * cuadro de peso daba 7.801.610.001.196 g.
 *
 * Ahora:
 * - Una ráfaga + Enter se intercepta en fase de captura y el Enter se cancela
 *   siempre: nunca presiona un botón ni envía un formulario.
 * - Si la ráfaga cayó en un campo, se le devuelve el valor que tenía antes.
 *   Excepción: los campos `data-scan-accept` (el código de barras de una
 *   ficha), donde escanear es justamente escribir el código.
 * - La lectura va a la pantalla que se registró última con `useScan`. Si
 *   ninguna escucha (un cuadro de peso o de precio abierto), se descarta con
 *   aviso y sonido de error: mejor perder una lectura que cobrar mal.
 */
export function ScanProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const handlers = useRef<{ current: ScanHandler }[]>([]);
  const burst = useRef<{ el: Element | null; prev: string | null }>({ el: null, prev: null });

  const ok = useCallback(() => {
    beep(1320, 70);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(30);
  }, []);
  const error = useCallback(() => {
    beep(220, 140, 2);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([80, 60, 80]);
  }, []);

  const register = useCallback((handler: { current: ScanHandler }) => {
    handlers.current.push(handler);
    return () => {
      handlers.current = handlers.current.filter((h) => h !== handler);
    };
  }, []);

  useEffect(() => {
    const detector = createScanDetector();

    const onKeyDown = (e: KeyboardEvent) => {
      const step = detector.feed(e.key, performance.now());

      if (step.kind === "start") {
        const el = document.activeElement;
        burst.current = { el, prev: isEditable(el) ? el.value : null };
        return;
      }
      if (step.kind !== "scan") return;

      e.preventDefault();
      e.stopPropagation();

      const { el, prev } = burst.current;
      burst.current = { el: null, prev: null };

      if (isEditable(el) && el.hasAttribute("data-scan-accept")) {
        ok();
        return;
      }
      if (isEditable(el) && prev !== null) setNativeValue(el, prev);

      const handler = handlers.current.at(-1);
      if (!handler) {
        error();
        showToast("Lectura ignorada: termina lo que estás haciendo y vuelve a escanear", "warning", 3500);
        return;
      }
      ok();
      handler.current(step.code);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [ok, error, showToast]);

  const value = useMemo(() => ({ register, ok, error }), [register, ok, error]);
  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}

/**
 * Recibe las lecturas del láser mientras `enabled`. Si hay varias pantallas
 * escuchando (Venta y el modal de cámara encima), gana la última registrada.
 */
export function useScan(onScan: ScanHandler, enabled = true) {
  const ctx = useContext(ScanContext);
  const ref = useRef(onScan);
  useEffect(() => {
    ref.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!ctx || !enabled) return;
    return ctx.register(ref);
  }, [ctx, enabled]);
}

/** Sonido y vibración de lectura correcta / con problema ("no encontrado"). */
export function useScanFeedback() {
  const ctx = useContext(ScanContext);
  return useMemo(
    () => ({ ok: ctx?.ok ?? (() => {}), error: ctx?.error ?? (() => {}) }),
    [ctx]
  );
}
