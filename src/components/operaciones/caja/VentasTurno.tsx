"use client";

import React, { useEffect, useState } from "react";
import { ArrowPathIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useToast } from "@/contexts/ToastContext";
import { clp } from "@/lib/cierre/denominations";
import { paymentLabel } from "@/lib/pos/payments";
import { pagosPorGrupo, type VentaTurno } from "@/lib/caja/resumenTurno";
import {
  avisoDevolucion,
  resumenProductos,
  tienePedidoAnulacion,
  MINUTOS_ANULAR_VENDEDORA,
  type PermisoAnular,
} from "@/lib/caja/anular";
import Hoja from "./Hoja";

export interface ItemVenta {
  product_barcode: string;
  product_name: string | null;
  quantity: number | string;
  unit_price: number | string;
  subtotal: number | string;
}

export interface VentaDetalle extends VentaTurno {
  ts: string;
  voided_at?: string | null;
  void_reason?: string | null;
  voided_by?: string | null;
  seller_name?: string | null;
  notes?: string | null;
  sale_items?: ItemVenta[] | null;
}

const MOTIVOS = ["Error de cobro", "Cliente devolvió", "Duplicada", "Cantidad equivocada"];

/**
 * Venta para volver a cobrar después de "Anular y corregir". La lee Venta al
 * montarse (la recarga en el carrito y borra la clave). Formato estable: si
 * cambia, cambiar también el lado de Venta.
 */
export const CLAVE_CORREGIR = "pos.corregir.v1";

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-CL", {
    timeZone: "America/Santiago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** Quién atiende según el selector "¿Quién atiende?" de Venta, si existe. */
function quienAtiende(): string {
  try {
    const raw = localStorage.getItem("pos.attendant.v1");
    if (!raw) return "";
    return String((JSON.parse(raw) as { name?: string }).name ?? "");
  } catch {
    return "";
  }
}

function metodosDe(v: VentaDetalle): string {
  const pagos = v.sale_payments ?? [];
  if (pagos.length === 0) return paymentLabel(v.payment_method);
  return [...new Set(pagos.map((p) => paymentLabel(p.method)))].join(" + ");
}

/**
 * "Ventas del turno" (Caja → Turno): cada fila dice método y primeros
 * productos, para encontrar la venta sin abrirlas una por una. Al tocarla se
 * ve el detalle y, si corresponde, se anula.
 */
export default function VentasTurno({
  ventas,
  onCambio,
  onCorregir,
}: {
  ventas: VentaDetalle[];
  shiftId: string;
  /** Algo cambió (anulada o pedida): recargar el turno. */
  onCambio: () => void;
  /** "Anular y corregir": ir a Venta con los productos cargados. */
  onCorregir?: () => void;
}) {
  const [abierta, setAbierta] = useState<VentaDetalle | null>(null);

  if (ventas.length === 0) return null;

  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
      <p className="text-xs font-black uppercase tracking-widest text-white/45 mb-3">
        Ventas del turno ({ventas.filter((v) => !v.voided).length})
      </p>
      <div className="space-y-2 max-h-[28rem] overflow-y-auto">
        {ventas.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setAbierta(v)}
            className={`w-full min-h-14 flex items-center gap-3 p-3 rounded-xl text-left active:bg-white/10 ${
              v.voided ? "bg-white/[0.02]" : "bg-white/5"
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm">
                <span className={`font-black ${v.voided ? "text-white/35 line-through" : "text-white"}`}>
                  #{v.id}
                </span>
                <span className="text-white/45 ml-2 tabular-nums">{hora(v.ts)}</span>
                <span className="text-white/60 ml-2">{metodosDe(v)}</span>
              </p>
              <p className={`text-sm truncate ${v.voided ? "text-white/30" : "text-white/55"}`}>
                {resumenProductos(v.sale_items) || "Sin detalle"}
              </p>
              {v.voided && <p className="text-xs font-black uppercase text-red-400/80">Anulada</p>}
              {!v.voided && tienePedidoAnulacion(v.notes) && (
                <p className="text-xs font-black uppercase text-amber-400">Anulación pedida</p>
              )}
            </div>
            <span
              className={`font-black tabular-nums shrink-0 ${
                v.voided ? "text-white/30 line-through" : v.is_staff_purchase ? "text-amber-300" : "text-emerald-400"
              }`}
            >
              {clp(v.total)}
            </span>
          </button>
        ))}
      </div>

      {abierta && (
        <DetalleVenta
          venta={abierta}
          onClose={() => setAbierta(null)}
          onCambio={onCambio}
          onCorregir={onCorregir}
        />
      )}
    </div>
  );
}

type Paso = "detalle" | "anular" | "pedir" | "hecho";

function DetalleVenta({
  venta,
  onClose,
  onCambio,
  onCorregir,
}: {
  venta: VentaDetalle;
  onClose: () => void;
  onCambio: () => void;
  onCorregir?: () => void;
}) {
  const { showToast } = useToast();
  const [permiso, setPermiso] = useState<PermisoAnular | null>(null);
  const [sinStock, setSinStock] = useState<string[]>([]);
  const [paso, setPaso] = useState<Paso>("detalle");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (venta.voided) return;
    let cancelado = false;
    fetch(`/api/caja/ventas/${venta.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { permiso?: PermisoAnular; sinStock?: string[] } | null) => {
        if (cancelado || !d) return;
        setPermiso(d.permiso ?? null);
        setSinStock(d.sinStock ?? []);
      })
      .catch(() => {
        /* sin red no se puede anular: queda sólo el detalle */
      });
    return () => {
      cancelado = true;
    };
  }, [venta.id, venta.voided]);

  const avisos = avisoDevolucion(venta);
  const efectivo = pagosPorGrupo(venta).efectivo;

  const anular = async (corregir: boolean) => {
    if (!motivo.trim() || enviando) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/caja/ventas/${venta.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim(), atendio: quienAtiende() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; yaAnulada?: boolean };
      if (!res.ok) {
        showToast(data.error ?? "No se pudo anular la venta", "error");
        return;
      }
      showToast(data.yaAnulada ? `La venta #${venta.id} ya estaba anulada` : `Venta #${venta.id} anulada ✓`, "success");
      onCambio();
      if (corregir && onCorregir && !data.yaAnulada) {
        try {
          localStorage.setItem(
            CLAVE_CORREGIR,
            JSON.stringify({
              saleId: venta.id,
              savedAt: new Date().toISOString(),
              items: (venta.sale_items ?? []).map((i) => ({
                barcode: i.product_barcode,
                name: i.product_name,
                qty: Number(i.quantity),
                unitPrice: Number(i.unit_price),
              })),
            })
          );
        } catch {
          /* sin localStorage: se vuelve a escanear */
        }
        onCorregir();
        return;
      }
      setPaso("hecho");
    } catch {
      showToast("Sin conexión: la venta no se anuló. Reintenta con red.", "error");
    } finally {
      setEnviando(false);
    }
  };

  const pedir = async () => {
    if (!motivo.trim() || enviando) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/caja/ventas/${venta.id}/pedir-anulacion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim(), atendio: quienAtiende() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(data.error ?? "No se pudo pedir la anulación", "error");
        return;
      }
      showToast("Pedido enviado: el administrador la verá marcada", "success");
      onCambio();
      onClose();
    } catch {
      showToast("Sin conexión. Reintenta con red.", "error");
    } finally {
      setEnviando(false);
    }
  };

  const motivoUI = (
    <div className="space-y-2">
      <p className="text-xs font-black uppercase tracking-widest text-white/50">¿Por qué?</p>
      <div className="grid grid-cols-2 gap-2">
        {MOTIVOS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMotivo(m)}
            className={`min-h-12 px-2 rounded-xl text-sm font-bold border ${
              motivo === m
                ? "bg-white text-black border-white"
                : "bg-white/5 text-white/70 border-white/10 active:bg-white/10"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <input
        type="text"
        aria-label="Motivo de la anulación"
        placeholder="Otro motivo…"
        value={MOTIVOS.includes(motivo) ? "" : motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className="w-full h-12 bg-black border border-white/10 rounded-xl px-3 text-base text-white outline-none focus:border-emerald-500"
      />
    </div>
  );

  return (
    <Hoja titulo={`Venta #${venta.id} · ${hora(venta.ts)}`} onClose={onClose}>
      {paso === "hecho" ? (
        <div className="text-center space-y-3 py-4">
          <p className="text-lg font-black text-white">Venta #{venta.id} anulada</p>
          {efectivo > 0 ? (
            <p className="text-3xl font-black text-amber-300">Devuelve {clp(efectivo)}</p>
          ) : null}
          {avisos
            .filter((a) => !a.startsWith("Devuelve"))
            .map((a) => (
              <p key={a} className="text-sm text-white/70">{a}</p>
            ))}
          <p className="text-sm text-white/45">El esperado en caja ya se ajustó.</p>
          <button
            type="button"
            onClick={onClose}
            className="w-full h-14 rounded-2xl bg-white text-black text-sm font-black uppercase tracking-widest"
          >
            Listo
          </button>
        </div>
      ) : (
        <>
          {/* Detalle */}
          <div className="space-y-1.5">
            {(venta.sale_items ?? []).map((i, idx) => (
              <div key={idx} className="flex justify-between gap-3 text-sm">
                <span className="text-white/80 min-w-0">
                  {i.product_name ?? i.product_barcode}
                  <span className="text-white/45 ml-1.5 tabular-nums">
                    {Number(i.quantity).toLocaleString("es-CL")} × {clp(i.unit_price)}
                  </span>
                </span>
                <span className="font-bold text-white tabular-nums shrink-0">{clp(i.subtotal)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t border-white/10">
              <span className="text-sm font-black uppercase text-white/60">Total</span>
              <span className="text-xl font-black text-emerald-400 tabular-nums">{clp(venta.total)}</span>
            </div>
            {(venta.sale_payments ?? []).map((p, idx) => (
              <div key={idx} className="flex justify-between text-sm text-white/60">
                <span>{paymentLabel(p.method)}</span>
                <span className="tabular-nums">{clp(p.amount)}</span>
              </div>
            ))}
            {venta.seller_name && (
              <p className="text-sm text-white/50">
                {venta.is_staff_purchase ? "Compra de" : "Vendedor"}:{" "}
                <span className="text-white/80">{venta.seller_name}</span>
              </p>
            )}
            {venta.notes && <p className="text-xs text-white/40 whitespace-pre-line">{venta.notes}</p>}
          </div>

          {venta.voided && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-200">
              Anulada{venta.void_reason ? `: ${venta.void_reason}` : ""}
              {venta.voided_by ? ` · ${venta.voided_by}` : ""}
            </div>
          )}

          {!venta.voided && paso === "detalle" && permiso && (
            permiso.ok ? (
              <button
                type="button"
                onClick={() => setPaso("anular")}
                className="w-full h-14 rounded-2xl bg-red-500/15 border border-red-500/40 text-red-300 text-sm font-black uppercase tracking-widest active:bg-red-500/25"
              >
                Anular venta
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-white/55">{permiso.motivo}</p>
                {!tienePedidoAnulacion(venta.notes) && (
                  <button
                    type="button"
                    onClick={() => setPaso("pedir")}
                    className="w-full h-14 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-sm font-black uppercase tracking-widest active:bg-amber-500/25"
                  >
                    Pedir anulación al admin
                  </button>
                )}
              </div>
            )
          )}

          {paso === "anular" && (
            <div className="space-y-3">
              {motivoUI}
              {avisos.length > 0 && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 space-y-1">
                  {avisos.map((a, idx) => (
                    <p key={a} className={idx === 0 && efectivo > 0 ? "text-lg font-black text-amber-200" : "text-sm text-amber-100"}>
                      {a}
                    </p>
                  ))}
                </div>
              )}
              {sinStock.length > 0 && (
                <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-sm text-white/70 flex gap-2">
                  <ExclamationTriangleIcon className="w-5 h-5 text-amber-400 shrink-0" />
                  <span>
                    {sinStock.join(", ")} {sinStock.length === 1 ? "estaba" : "estaban"} sin stock: al anular
                    el sistema le suma lo vendido. Revisa su stock después.
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void anular(false)}
                  disabled={!motivo.trim() || enviando}
                  className="h-14 rounded-2xl bg-red-500 text-black text-sm font-black uppercase tracking-wide disabled:opacity-40 flex items-center justify-center gap-2 active:bg-red-600"
                >
                  {enviando && <ArrowPathIcon className="w-5 h-5 animate-spin" />}
                  Anular
                </button>
                {onCorregir && (
                  <button
                    type="button"
                    onClick={() => void anular(true)}
                    disabled={!motivo.trim() || enviando}
                    className="h-14 rounded-2xl bg-white text-black text-sm font-black uppercase tracking-wide disabled:opacity-40 active:bg-white/80"
                  >
                    Anular y corregir
                  </button>
                )}
              </div>
              <p className="text-xs text-white/40 leading-relaxed">
                &quot;Anular y corregir&quot; vuelve a Venta con los mismos productos para cobrarlos bien.
              </p>
            </div>
          )}

          {paso === "pedir" && (
            <div className="space-y-3">
              {motivoUI}
              <p className="text-xs text-white/45">
                Una vendedora puede anular sólo ventas del turno abierto de los últimos{" "}
                {MINUTOS_ANULAR_VENDEDORA} minutos. Esta queda marcada para el administrador.
              </p>
              <button
                type="button"
                onClick={() => void pedir()}
                disabled={!motivo.trim() || enviando}
                className="w-full h-14 rounded-2xl bg-amber-500 text-black text-sm font-black uppercase tracking-widest disabled:opacity-40"
              >
                Enviar pedido
              </button>
            </div>
          )}
        </>
      )}
    </Hoja>
  );
}
