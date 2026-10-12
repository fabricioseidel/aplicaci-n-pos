import { Capacitor, registerPlugin } from "@capacitor/core";
import { aBase64, ticketEscPos } from "@/lib/print/escpos";

/**
 * Impresión directa en la térmica Bluetooth, vía el plugin propio del APK
 * (`android/app/src/main/java/cl/olivomarket/pos/ImpresoraBTPlugin.java`).
 *
 * Un APK anterior al plugin no lo trae: `hayImpresoraBT()` da false y quien
 * llama sigue con el PDF por el menú de compartir, como antes.
 */

export interface DispositivoBT {
  nombre: string | null;
  direccion: string;
}

interface ImpresoraBTPlugin {
  listar(): Promise<{ dispositivos: DispositivoBT[] }>;
  imprimir(opts: { direccion: string; datos: string }): Promise<void>;
}

const ImpresoraBT = registerPlugin<ImpresoraBTPlugin>("ImpresoraBT");

export const hayImpresoraBT = () => Capacitor.isPluginAvailable("ImpresoraBT");

export async function listarVinculadas(): Promise<DispositivoBT[]> {
  return (await ImpresoraBT.listar()).dispositivos ?? [];
}

export async function imprimirLineas(direccion: string, lineas: string[]): Promise<void> {
  await ImpresoraBT.imprimir({ direccion, datos: aBase64(ticketEscPos(lineas)) });
}

// ── Qué impresora usar ─────────────────────────────────────────────────────

const CLAVE = "pos.impresora.v1";

/** Nombres con que se anuncian las térmicas (MPT-II, MTP-2, XP-58, "Printer"…). */
const PARECE_IMPRESORA = /MPT|MTP|print|impres|thermal|\bPOS\b|\bXP-|\bRPP|\bPT-?\d/i;

export function impresoraGuardada(): DispositivoBT | null {
  try {
    const raw = localStorage.getItem(CLAVE);
    return raw ? (JSON.parse(raw) as DispositivoBT) : null;
  } catch {
    return null;
  }
}

export function guardarImpresora(d: DispositivoBT | null): void {
  try {
    if (d) localStorage.setItem(CLAVE, JSON.stringify(d));
    else localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento se vuelve a preguntar la próxima vez */
  }
}

/**
 * La impresora a usar sin preguntar, o null si hay que elegir.
 *
 * Primero la última que funcionó, si sigue vinculada. Si no, la única que
 * parezca impresora: el teléfono suele tener también audífonos o el auto
 * vinculados, y mandarles el ticket no sirve.
 */
export function elegirImpresora(
  vinculadas: DispositivoBT[],
  guardada: DispositivoBT | null
): DispositivoBT | null {
  if (guardada) {
    const sigue = vinculadas.find((d) => d.direccion === guardada.direccion);
    if (sigue) return sigue;
  }
  const impresoras = vinculadas.filter((d) => PARECE_IMPRESORA.test(d.nombre ?? ""));
  if (impresoras.length === 1) return impresoras[0];
  if (impresoras.length === 0 && vinculadas.length === 1) return vinculadas[0];
  return null;
}

/** Texto para el cajero según el código con que rechaza el plugin. */
export function mensajeErrorBT(codigo: string | undefined): string {
  switch (codigo) {
    case "permiso":
      return "Falta el permiso de Bluetooth. Actívalo en Ajustes → Apps → Olivo POS → Permisos.";
    case "apagado":
      return "El Bluetooth está apagado. Enciéndelo y vuelve a imprimir.";
    case "no-vinculada":
      return "La impresora ya no está vinculada. Vincúlala en Ajustes → Bluetooth.";
    case "sin-bluetooth":
      return "Este equipo no tiene Bluetooth.";
    default:
      return "No se pudo conectar con la impresora. Revisa que esté encendida y cerca.";
  }
}
