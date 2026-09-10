"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  ClipboardDocumentCheckIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  PlusCircleIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import UnifiedScanner from "@/components/scanner/UnifiedScanner";
import QuickCreateReceptionModal from "@/components/operaciones/QuickCreateReceptionModal";
import { useProductCatalog } from "@/hooks/useProductCatalog";
import { useBranch } from "@/contexts/BranchContext";
import { useSync } from "@/contexts/SyncContext";
import { useToast } from "@/contexts/ToastContext";
import { apiWrite } from "@/lib/offline/apiWrite";
import { searchProducts } from "@/lib/pos/search";
import type { ProductUI } from "@/types";

const SEARCH_RESULTS_LIMIT = 8;
const BORRADOR_KEY = "olivo-pos.conteo.borrador";
const SESION_KEY = "olivo-pos.conteo.sesion";

interface CountProgress {
  sessionId: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  openedBy: string | null;
  contados: number;
  unidades: number;
  conDiferencia: number;
  diferenciaNeta: number;
  enCero: number;
  pendientes: number;
  totalCatalogo: number;
}

/** Una línea del conteo en curso, todavía sin enviar. */
interface Linea {
  barcode: string;
  name: string;
  /** Cantidad contada. Es absoluta: reemplaza el stock, no lo suma. */
  qty: number;
  /** Lo que el sistema dice que hay, para ver la diferencia en pantalla. */
  sistema: number;
  byWeight: boolean;
}

/**
 * Conteo físico de inventario.
 *
 * La diferencia con Recepción —y la razón por la que contar con Recepción
 * corrompía el stock— es que acá la cantidad es ABSOLUTA: "hay 5" deja 5, no
 * suma 5 a lo que el sistema creía. Contar dos veces el mismo producto, o que
 * el outbox reenvíe un lote tras una caída de red, no puede duplicar nada.
 *
 * El cierre es lo que responde "qué hay disponible hoy": lo que nunca se
 * escaneó queda en 0 y sale del catálogo.
 */
export default function ConteoMode() {
  const { data: authSession } = useSession();
  const esAdmin = (authSession?.user?.role ?? "").toString().toUpperCase() === "ADMIN";

  const { currentBranch } = useBranch();
  const { products: catalogo, upsertLocal, refresh: refrescarCatalogo } = useProductCatalog();
  const { refreshPending } = useSync();
  const { showToast } = useToast();

  const [progreso, setProgreso] = useState<CountProgress | null>(null);
  /**
   * Conteo abierto recordado en el teléfono. La bodega es justo donde peor
   * entra el wifi: sin esto, quedarse sin red a mitad de una góndola dejaba la
   * pantalla en "no hay conteo abierto" y no se podía seguir escaneando, aunque
   * el outbox pudiera guardarlo perfectamente.
   */
  const [sesionRecordada, setSesionRecordada] = useState<{
    sessionId: string;
    openedAt: string;
    openedBy: string | null;
  } | null>(null);
  const [sinConexion, setSinConexion] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [abriendo, setAbriendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [empezarEnCero, setEmpezarEnCero] = useState(false);

  const [lineas, setLineas] = useState<Linea[]>([]);
  const [query, setQuery] = useState("");
  const [creando, setCreando] = useState<{ barcode: string; name: string } | null>(null);
  const buscadorRef = useRef<HTMLInputElement>(null);
  const ultimoCodigo = useRef<string>("");
  const borradorCargado = useRef(false);

  // ── Borrador local ────────────────────────────────────────────────
  // La lista de abajo vive en el teléfono hasta que se guarda. Si la app se
  // cierra a mitad de una góndola, lo escaneado no se puede perder.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BORRADOR_KEY);
      if (raw) setLineas(JSON.parse(raw) as Linea[]);
      const sesion = window.localStorage.getItem(SESION_KEY);
      if (sesion) setSesionRecordada(JSON.parse(sesion));
    } catch {
      /* sin localStorage (modo privado): se cuenta igual, sin borrador */
    }
    borradorCargado.current = true;
  }, []);

  useEffect(() => {
    if (!borradorCargado.current) return;
    try {
      if (lineas.length === 0) window.localStorage.removeItem(BORRADOR_KEY);
      else window.localStorage.setItem(BORRADOR_KEY, JSON.stringify(lineas));
    } catch {
      /* noop */
    }
  }, [lineas]);

  const recordarSesion = useCallback((s: CountProgress | null) => {
    try {
      if (!s) window.localStorage.removeItem(SESION_KEY);
      else
        window.localStorage.setItem(
          SESION_KEY,
          JSON.stringify({ sessionId: s.sessionId, openedAt: s.openedAt, openedBy: s.openedBy })
        );
    } catch {
      /* noop */
    }
  }, []);

  // ── Estado del conteo en el servidor ──────────────────────────────
  const cargarProgreso = useCallback(async () => {
    try {
      const url = currentBranch?.id
        ? `/api/inventario/conteo?branchId=${encodeURIComponent(currentBranch.id)}`
        : "/api/inventario/conteo";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo leer el conteo");

      const sesion = (data.session ?? null) as CountProgress | null;
      setProgreso(sesion);
      setSinConexion(false);

      // El servidor manda: si allá el conteo se cerró, se olvida acá también.
      recordarSesion(sesion && sesion.status === "OPEN" ? sesion : null);
      setSesionRecordada(
        sesion && sesion.status === "OPEN"
          ? { sessionId: sesion.sessionId, openedAt: sesion.openedAt, openedBy: sesion.openedBy }
          : null
      );
    } catch {
      // Sin red no se sabe el progreso, pero sí con qué conteo se estaba
      // trabajando: se sigue escaneando y el outbox lo entrega al volver.
      setProgreso(null);
      setSinConexion(true);
    } finally {
      setCargando(false);
    }
  }, [currentBranch?.id, recordarSesion]);

  useEffect(() => {
    void cargarProgreso();
  }, [cargarProgreso]);

  const abrirConteo = async () => {
    if (empezarEnCero) {
      const ok = window.confirm(
        "Vas a poner TODO el stock de esta sucursal en 0 antes de empezar.\n\n" +
          "Mientras dure el conteo la tienda web no va a poder vender nada, porque " +
          "todo va a figurar sin existencias.\n\n" +
          "No hace falta: al cerrar el conteo, lo que no hayas contado queda en 0 igual.\n\n" +
          "¿Continuar de todas formas?"
      );
      if (!ok) return;
    }

    setAbriendo(true);
    try {
      const res = await fetch("/api/inventario/conteo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: currentBranch?.id ?? null, zeroNow: empezarEnCero }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo abrir el conteo");

      const sesion = (data.session ?? null) as CountProgress | null;
      setProgreso(sesion);
      recordarSesion(sesion);
      setSesionRecordada(
        sesion
          ? { sessionId: sesion.sessionId, openedAt: sesion.openedAt, openedBy: sesion.openedBy }
          : null
      );
      showToast(
        data.yaAbierta
          ? "Ya había un conteo abierto: seguimos con ese"
          : data.puestosEnCero > 0
            ? `Conteo abierto. ${data.puestosEnCero} productos quedaron en 0`
            : "Conteo abierto",
        "success"
      );
      setEmpezarEnCero(false);
      void refrescarCatalogo();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo abrir el conteo", "error");
    } finally {
      setAbriendo(false);
    }
  };

  // ── Armado de la lista ────────────────────────────────────────────
  const agregar = useCallback((product: ProductUI, cantidad?: number) => {
    const barcode = product.barcode || product.id;
    const paso = product.byWeight ? 0.5 : 1;

    setLineas((prev) => {
      const idx = prev.findIndex((l) => l.barcode === barcode);
      if (idx === -1) {
        return [
          {
            barcode,
            name: product.name,
            qty: cantidad ?? paso,
            sistema: Number(product.stock ?? 0),
            byWeight: Boolean(product.byWeight),
          },
          ...prev,
        ];
      }
      // Volver a escanear el mismo producto suma una unidad: así se cuenta
      // una góndola, pasando el lector por cada envase.
      const next = [...prev];
      next[idx] = { ...next[idx], qty: next[idx].qty + (cantidad ?? paso) };
      return next;
    });
  }, []);

  const onDetected = useCallback(
    async (code: string) => {
      const limpio = code.trim();
      if (!limpio) return;

      // El anti-rebote del lector es por código, no global: contar de a una
      // unidad exige poder escanear el MISMO código muchas veces seguidas,
      // sólo no dos veces por el mismo destello.
      if (limpio === ultimoCodigo.current) return;
      ultimoCodigo.current = limpio;
      setTimeout(() => {
        if (ultimoCodigo.current === limpio) ultimoCodigo.current = "";
      }, 600);

      const encontrado = catalogo.find((p) => p.barcode === limpio || p.id === limpio);
      if (encontrado) {
        agregar(encontrado);
        return;
      }

      // El catálogo del POS sólo trae activos: un producto que un conteo
      // anterior dio por no disponible no está ahí. Antes de ofrecer crearlo
      // hay que preguntarle a la base, o se termina con dos fichas del mismo
      // producto y el stock repartido entre las dos.
      try {
        const res = await fetch(
          `/api/inventario/buscar?barcode=${encodeURIComponent(limpio)}`,
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = (await res.json()) as { producto?: ProductUI | null };
          if (data.producto) {
            upsertLocal(data.producto);
            agregar(data.producto);
            showToast(`Reactivado: ${data.producto.name}`, "success");
            return;
          }
        }
      } catch {
        // Sin red no se puede descartar que exista inactivo. Se ofrece crearlo
        // igual (el modal sugiere fusionar si el nombre se parece a algo).
      }

      setCreando({ barcode: limpio, name: "" });
    },
    [catalogo, agregar, upsertLocal, showToast]
  );

  const resultados = useMemo(
    () => (query.trim() ? searchProducts(catalogo, query).slice(0, SEARCH_RESULTS_LIMIT) : []),
    [query, catalogo]
  );

  /**
   * Cuando el catálogo local no encuentra nada, se pregunta a la base, que sí
   * incluye los inactivos. Un producto que un conteo anterior dio por no
   * disponible tiene que poder reaparecer contándolo, no creándolo de nuevo.
   */
  const [resultadosInactivos, setResultadosInactivos] = useState<ProductUI[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || resultados.length > 0) {
      setResultadosInactivos([]);
      return;
    }

    let cancelado = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/inventario/buscar?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { productos?: ProductUI[] };
        if (!cancelado) setResultadosInactivos((data.productos ?? []).slice(0, SEARCH_RESULTS_LIMIT));
      } catch {
        /* sin red no hay nada que sumar a lo local */
      }
    }, 350);

    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [query, resultados.length]);

  const fijarCantidad = (barcode: string, qty: number) => {
    setLineas((prev) =>
      prev.map((l) => (l.barcode === barcode ? { ...l, qty: Math.max(0, qty) } : l))
    );
  };

  const quitar = (barcode: string) => {
    setLineas((prev) => prev.filter((l) => l.barcode !== barcode));
  };

  /**
   * Conteo con el que se está trabajando. Con red manda el servidor; sin red
   * vale el que quedó recordado en el teléfono, para poder seguir escaneando.
   */
  const sesionAbierta = progreso?.status === "OPEN" ? progreso : null;
  const sessionIdActivo =
    sesionAbierta?.sessionId ?? (sinConexion ? sesionRecordada?.sessionId ?? null : null);

  // ── Guardar lo contado ────────────────────────────────────────────
  const guardar = async () => {
    if (lineas.length === 0 || !sessionIdActivo) return;
    setGuardando(true);
    try {
      const res = await apiWrite<{ aplicados: number; ajustados: number; desconocidos: string[] }>({
        kind: "count",
        url: "/api/inventario/conteo/items",
        // Deduplicación en la base. Además la cantidad es absoluta, así que
        // reenviar el lote no puede sumar dos veces ni con el opId perdido.
        idField: "opId",
        payload: {
          items: lineas.map((l) => ({ barcode: l.barcode, qty: l.qty })),
          sessionId: sessionIdActivo,
          branchId: currentBranch?.id ?? null,
        },
      });

      if (res.ok && res.queued) {
        showToast("Conteo guardado sin conexión — se sincronizará", "success");
        setLineas([]);
        await refreshPending();
        return;
      }

      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }

      const desconocidos = res.data?.desconocidos ?? [];
      showToast(
        `${res.data?.aplicados ?? lineas.length} productos contados` +
          (desconocidos.length > 0 ? ` · ${desconocidos.length} sin catálogo` : ""),
        "success"
      );
      setLineas([]);
      await cargarProgreso();
      void refrescarCatalogo();
    } finally {
      setGuardando(false);
    }
  };

  // ── Cerrar el conteo ──────────────────────────────────────────────
  const cerrar = async () => {
    if (!sesionAbierta) return;
    const progreso = sesionAbierta;

    if (lineas.length > 0) {
      showToast("Guarda primero lo que tienes en la lista", "error");
      return;
    }

    const ok = window.confirm(
      `Vas a cerrar el conteo.\n\n` +
        `· ${progreso.contados} productos contados quedan con la cantidad que registraste.\n` +
        `· ${progreso.pendientes} productos que nunca se escanearon quedan en 0 y dejan de estar disponibles.\n\n` +
        `Esto es lo que define qué hay en la tienda hoy. ¿Continuar?`
    );
    if (!ok) return;

    setCerrando(true);
    try {
      const res = await fetch("/api/inventario/conteo/cerrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: progreso.sessionId,
          esperadoPendientes: progreso.pendientes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          showToast(
            `El conteo cambió mientras confirmabas (${data.actual} sin contar). Revisa y vuelve a intentar.`,
            "error"
          );
          await cargarProgreso();
          return;
        }
        throw new Error(data.error || "No se pudo cerrar el conteo");
      }

      showToast(
        `Conteo cerrado: ${data.contados} contados, ${data.desactivados} fuera del catálogo`,
        "success"
      );
      await cargarProgreso();
      void refrescarCatalogo();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo cerrar el conteo", "error");
    } finally {
      setCerrando(false);
    }
  };

  const totalUnidades = lineas.reduce((acc, l) => acc + l.qty, 0);

  // ── Sin conteo abierto ────────────────────────────────────────────
  if (cargando) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center text-white/40">
        <ArrowPathIcon className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  if (!sessionIdActivo) {
    return (
      <div className="max-w-2xl mx-auto p-5 space-y-5">
        {sinConexion && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-xs text-amber-200/80 leading-relaxed">
              Sin conexión y sin un conteo empezado en este teléfono. El conteo se abre con red;
              después se puede seguir escaneando sin ella.
            </p>
          </div>
        )}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-400">
              <ClipboardDocumentCheckIcon className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase italic tracking-tight">Conteo</h1>
              <p className="text-sm text-white/40">
                {currentBranch?.name ?? "Sucursal principal"}
              </p>
            </div>
          </div>

          <div className="space-y-3 text-sm text-white/60 leading-relaxed">
            <p>
              Escanea la tienda producto por producto y escribe cuántos hay de verdad.{" "}
              <strong className="text-white">La cantidad reemplaza el stock, no lo suma</strong> —
              es lo que Recepción no podía hacer.
            </p>
            <p>
              Al cerrar el conteo, lo que no hayas escaneado queda en 0 y deja de estar
              disponible. Eso es lo que define el catálogo del día.
            </p>
          </div>

          {esAdmin && (
            <label className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={empezarEnCero}
                onChange={(e) => setEmpezarEnCero(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-amber-500"
              />
              <span className="text-xs text-amber-200/80 leading-relaxed">
                Poner todo en 0 antes de empezar.{" "}
                <strong>No es necesario</strong> y deja la tienda web sin stock durante todo el
                conteo: al cerrar, lo no contado queda en 0 igual.
              </span>
            </label>
          )}

          <button
            onClick={abrirConteo}
            disabled={abriendo || sinConexion}
            className="w-full h-14 rounded-2xl bg-emerald-500 text-black text-sm font-black uppercase tracking-widest disabled:bg-white/10 disabled:text-white/40"
          >
            {abriendo ? "Abriendo…" : "Empezar conteo"}
          </button>
        </div>
      </div>
    );
  }

  // ── Conteo en curso ───────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase italic tracking-tight">Conteo</h1>
          <p className="text-[11px] text-white/40">
            {(() => {
              const abierto = sesionAbierta?.openedAt ?? sesionRecordada?.openedAt;
              const por = sesionAbierta?.openedBy ?? sesionRecordada?.openedBy;
              return `Abierto ${abierto ? new Date(abierto).toLocaleString("es-CL") : "—"}${
                por ? ` · ${por}` : ""
              }`;
            })()}
          </p>
        </div>
        <button
          onClick={() => void cargarProgreso()}
          className="text-white/30 hover:text-white/70 p-2"
          title="Actualizar"
        >
          <ArrowPathIcon className="w-4 h-4" />
        </button>
      </div>

      {sinConexion && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs text-amber-200/80 leading-relaxed">
            Sin conexión: sigue escaneando. Lo que guardes queda en la cola y entra solo cuando
            vuelva la red. El avance y el cierre necesitan conexión.
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white/5 rounded-2xl p-3 border border-white/10 text-center">
          <p className="text-2xl font-black text-emerald-400 tabular-nums">
            {sesionAbierta?.contados ?? "—"}
          </p>
          <p className="text-[9px] font-black uppercase tracking-widest text-white/40 mt-0.5">
            Contados
          </p>
        </div>
        <div className="bg-white/5 rounded-2xl p-3 border border-white/10 text-center">
          <p className="text-2xl font-black text-amber-400 tabular-nums">
            {sesionAbierta?.pendientes ?? "—"}
          </p>
          <p className="text-[9px] font-black uppercase tracking-widest text-white/40 mt-0.5">
            Sin contar
          </p>
        </div>
        <div className="bg-white/5 rounded-2xl p-3 border border-white/10 text-center">
          <p
            className={`text-2xl font-black tabular-nums ${
              (sesionAbierta?.diferenciaNeta ?? 0) < 0 ? "text-red-400" : "text-white/70"
            }`}
          >
            {sesionAbierta
              ? `${sesionAbierta.diferenciaNeta > 0 ? "+" : ""}${sesionAbierta.diferenciaNeta}`
              : "—"}
          </p>
          <p className="text-[9px] font-black uppercase tracking-widest text-white/40 mt-0.5">
            Diferencia
          </p>
        </div>
      </div>

      {/* Buscador por nombre: no todo tiene código legible */}
      <div className="space-y-2">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <input
            ref={buscadorRef}
            type="text"
            placeholder="Buscar producto por nombre…"
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-9 pr-9 text-white text-sm outline-none focus:border-emerald-500"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white p-1"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {query.trim() && (
          <ul className="space-y-1.5 max-h-64 overflow-y-auto">
            {resultados.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => {
                    agregar(p);
                    setQuery("");
                    buscadorRef.current?.focus();
                  }}
                  className="w-full flex items-center gap-3 text-left bg-white/5 hover:bg-white/10 rounded-xl p-3 border border-white/10 transition-colors"
                >
                  <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center shrink-0 border border-white/10">
                    <ArchiveBoxIcon className="w-5 h-5 text-white/20" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{p.name}</p>
                    <p className="text-[10px] text-white/40 font-mono mt-0.5">
                      {p.barcode || p.id} · sistema {p.stock}
                    </p>
                  </div>
                </button>
              </li>
            ))}
            {resultados.length === 0 &&
              resultadosInactivos.map((p) => (
                <li key={`inactivo-${p.id}`}>
                  <button
                    onClick={() => {
                      upsertLocal(p);
                      agregar(p);
                      setQuery("");
                      buscadorRef.current?.focus();
                    }}
                    className="w-full flex items-center gap-3 text-left bg-amber-500/5 hover:bg-amber-500/10 rounded-xl p-3 border border-amber-500/30 transition-colors"
                  >
                    <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center shrink-0 border border-white/10">
                      <ArchiveBoxIcon className="w-5 h-5 text-amber-400/40" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{p.name}</p>
                      <p className="text-[10px] text-amber-300/60 font-mono mt-0.5">
                        {p.barcode || p.id} · fuera del catálogo · contarlo lo reactiva
                      </p>
                    </div>
                  </button>
                </li>
              ))}

            {resultados.length === 0 && (
              <li className="py-3 text-center">
                <p className="text-xs text-white/30 mb-2">
                  {resultadosInactivos.length > 0
                    ? "¿Ninguno es el que buscas?"
                    : "Sin coincidencias."}
                </p>
                <button
                  onClick={() => setCreando({ barcode: "", name: query.trim() })}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-[10px] font-black uppercase tracking-widest"
                >
                  <PlusCircleIcon className="h-4 w-4" /> Crear &quot;{query.trim()}&quot;
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      <UnifiedScanner onDetected={onDetected} />

      {/* Lista sin guardar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 italic">
            Sin guardar ({lineas.length}) · {totalUnidades} unidades
          </p>
          {lineas.length > 0 && (
            <button
              onClick={() => setLineas([])}
              className="text-[10px] font-black uppercase tracking-widest text-red-400/80 hover:text-red-400 p-2 -mr-2"
            >
              Limpiar
            </button>
          )}
        </div>

        {lineas.length === 0 ? (
          <p className="text-xs text-white/30 text-center py-8 border-2 border-dashed border-white/10 rounded-3xl">
            Escanea un producto para contarlo. Cada escaneo del mismo código suma una unidad; también
            puedes escribir la cantidad.
          </p>
        ) : (
          <ul className="space-y-2">
            {lineas.map((l) => {
              const paso = l.byWeight ? 0.5 : 1;
              const diferencia = l.qty - l.sistema;
              return (
                <li
                  key={l.barcode}
                  className="bg-white/5 border border-white/5 rounded-2xl p-3 flex flex-col sm:flex-row gap-3 sm:items-center"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-sm uppercase tracking-tight truncate">{l.name}</p>
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mt-0.5">
                      {l.barcode} · sistema {l.sistema}
                      {diferencia !== 0 && (
                        <span className={diferencia < 0 ? "text-red-400" : "text-emerald-400"}>
                          {" "}
                          ({diferencia > 0 ? "+" : ""}
                          {l.byWeight ? diferencia.toFixed(2) : diferencia})
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2">
                    <div className="flex items-center gap-1 bg-black/40 p-1.5 rounded-2xl border border-white/5">
                      <button
                        onClick={() => fijarCantidad(l.barcode, l.qty - paso)}
                        aria-label="Restar"
                        className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center active:scale-90 transition-transform"
                      >
                        <MinusIcon className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={paso}
                        value={l.qty}
                        onChange={(e) => fijarCantidad(l.barcode, Number(e.target.value))}
                        aria-label={`Cantidad contada de ${l.name}`}
                        className="w-16 bg-transparent text-center text-lg font-black tabular-nums outline-none"
                      />
                      <button
                        onClick={() => fijarCantidad(l.barcode, l.qty + paso)}
                        aria-label="Sumar"
                        className="w-10 h-10 rounded-xl bg-white text-black flex items-center justify-center active:scale-90 transition-transform"
                      >
                        <PlusIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      onClick={() => quitar(l.barcode)}
                      aria-label="Quitar de la lista"
                      className="w-10 h-10 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center active:scale-90"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <button
        onClick={guardar}
        disabled={lineas.length === 0 || guardando}
        className={`w-full h-14 rounded-2xl text-sm font-black uppercase tracking-widest transition-colors ${
          lineas.length === 0 || guardando
            ? "bg-white/5 text-white/20"
            : "bg-emerald-500 text-black active:bg-emerald-600"
        }`}
      >
        {guardando ? "Guardando…" : `Guardar ${lineas.length} contados`}
      </button>

      {/* Cierre: define el catálogo disponible */}
      {sesionAbierta && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 space-y-3 mt-4">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black text-red-300">Cerrar conteo</p>
              <p className="text-xs text-red-200/70 leading-relaxed mt-1">
                Los <strong>{sesionAbierta.pendientes}</strong> productos que nunca se escanearon
                quedan en 0 y dejan de estar disponibles. Los{" "}
                <strong>{sesionAbierta.contados}</strong> contados quedan con la cantidad
                registrada. Hazlo cuando termines de recorrer la tienda.
              </p>
            </div>
          </div>
          {esAdmin ? (
            <button
              onClick={cerrar}
              disabled={cerrando}
              className="w-full rounded-xl bg-red-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-red-500 disabled:bg-white/10 disabled:text-white/40"
            >
              {cerrando ? "Cerrando…" : "Cerrar conteo"}
            </button>
          ) : (
            <p className="text-[10px] font-black uppercase tracking-widest text-white/30">
              Sólo un administrador puede cerrar el conteo
            </p>
          )}
        </div>
      )}

      {creando && (
        <QuickCreateReceptionModal
          initialBarcode={creando.barcode}
          initialName={creando.name}
          products={catalogo}
          onClose={() => setCreando(null)}
          onCreated={(product, quantity) => {
            upsertLocal(product);
            agregar(product, quantity);
            setCreando(null);
            setQuery("");
          }}
          onMerge={(product, quantity) => {
            agregar(product, quantity);
            setCreando(null);
            setQuery("");
          }}
        />
      )}
    </div>
  );
}
