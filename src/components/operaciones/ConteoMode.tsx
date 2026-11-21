"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  ClipboardDocumentCheckIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PencilSquareIcon,
  PlusIcon,
  PlusCircleIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import UnifiedScanner from "@/components/scanner/UnifiedScanner";
import SinCoincidencia from "@/components/operaciones/inventario/SinCoincidencia";
import HistorialInventario from "@/components/operaciones/inventario/HistorialInventario";
import YaEscaneados, { type ProductoContado } from "@/components/operaciones/inventario/YaEscaneados";
import PriceSheet from "@/components/operaciones/PriceSheet";
import FichaProducto from "@/components/operaciones/productos/FichaProducto";
import { useAttendant } from "@/hooks/useAttendant";
import { fetchCategorias } from "@/services/products";
import { useProductCatalog } from "@/hooks/useProductCatalog";
import { useBranch } from "@/contexts/BranchContext";
import { useSync } from "@/contexts/SyncContext";
import { useToast } from "@/contexts/ToastContext";
import { apiWrite } from "@/lib/offline/apiWrite";
import { searchProducts } from "@/lib/pos/search";
import QtyInput from "@/components/operaciones/inventario/QtyInput";
import CierreConteo from "@/components/operaciones/inventario/CierreConteo";
import { crearAntirebote, type ModoCierre } from "@/lib/inventario/conteo";
import type { ProductUI } from "@/types";

const SEARCH_RESULTS_LIMIT = 8;
const BORRADOR_KEY = "olivo-pos.conteo.borrador";
const SESION_KEY = "olivo-pos.conteo.sesion";

type ApplyMode = "ON_CLOSE" | "LIVE";
/** KEEP: se mantiene el inventario actual. ZERO: parte desde 0. */
type StartMode = "KEEP" | "ZERO";
/** Cada cuánto se trae lo que guardaron los otros teléfonos. */
const SONDEO_MS = 12000;

const fechaCorta = (ymd: string) => ymd.split("-").reverse().join("-");

interface CountProgress {
  sessionId: string;
  status: "OPEN" | "CLOSED";
  /**
   * ON_CLOSE: el conteo no toca el stock hasta cerrarse (la tienda sigue
   * vendiendo con sus números). LIVE: cada lote fija el stock al instante.
   */
  applyMode: ApplyMode;
  startMode?: StartMode;
  openedAt: string;
  openedBy: string | null;
  contados: number;
  unidades: number;
  conDiferencia: number;
  diferenciaNeta: number;
  enCero: number;
  /** Escaneos guardados: un producto puede tener varios, uno por lugar. */
  marcas: number;
  /** Productos vistos en más de un lugar (se sumaron, no se pisaron). */
  enVariosLugares: number;
  /** Productos que se vendieron o recibieron después de haberse contado. */
  movidosDesdeElConteo: number;
  pendientes: number;
  totalCatalogo: number;
}

/** Una línea del conteo en curso, todavía sin enviar. */
interface Linea {
  barcode: string;
  name: string;
  /** Cantidad vista en ESTE lugar. Se suma a lo ya contado del producto. */
  qty: number;
  /** Lo que el sistema dice que hay, para ver la diferencia en pantalla. */
  sistema: number;
  /**
   * Lo que ya se contó de este producto antes en la sesión (otro lugar del
   * recorrido). `null` = no se pudo consultar (sin red); sumar funciona igual.
   */
  yaContado: number | null;
  /** Reinicia lo contado del producto y deja sólo esta cantidad. */
  reemplazar: boolean;
  byWeight: boolean;
  /** Precio de venta vigente, para revisarlo al contar. */
  price?: number;
  /** Vencimiento visto, "YYYY-MM-DD"; "" o ausente si no se anotó. */
  expiry?: string;
  /** Quién contó cuánto de este producto antes en la sesión. */
  porPersona?: Array<{ por: string; qty: number }>;
}

/**
 * Conteo físico de inventario.
 *
 * La diferencia con Recepción —y la razón por la que contar con Recepción
 * corrompía el stock— es que acá la cantidad es ABSOLUTA: "hay 5" deja 5, no
 * suma 5 a lo que el sistema creía. Contar dos veces el mismo producto, o que
 * el outbox reenvíe un lote tras una caída de red, no puede duplicar nada.
 *
 * Por defecto el conteo es **independiente de las ventas**: escanear sólo
 * anota, el stock sigue intacto y la tienda vende con sus números todo el día.
 * Al cerrar se aplica todo junto y se corrige lo que se vendió o recibió
 * después de cada conteo, así las ventas del día no se pierden.
 *
 * El cierre aplica solo lo escaneado (conteo de góndola) o, en un conteo
 * total y solo un ADMIN, además pone en 0 y saca del catálogo lo no escaneado.
 */
export default function ConteoMode() {
  const { data: authSession } = useSession();
  const esAdmin = (authSession?.user?.role ?? "").toString().toUpperCase() === "ADMIN";

  const { currentBranch } = useBranch();
  const { products: catalogo, upsertLocal, refresh: refrescarCatalogo } = useProductCatalog();
  const { refreshPending } = useSync();
  const { showToast } = useToast();
  /** Quién cuenta en ESTE teléfono: cada lote queda a su nombre. */
  const { attendant } = useAttendant();
  const quien = attendant?.name ?? authSession?.user?.name ?? null;

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
  /**
   * Cómo empieza: manteniendo el inventario actual (sólo cambia lo escaneado)
   * o desde 0 (lo que no se cuente queda en 0 al cerrar). En los dos casos el
   * stock se aplica al cerrar: la tienda sigue vendiendo mientras se cuenta.
   */
  const [inicio, setInicio] = useState<StartMode>("KEEP");
  /** Línea a la que se le está corrigiendo el precio. */
  const [precioDe, setPrecioDe] = useState<Linea | null>(null);
  /** Producto abierto en la ficha completa para editarlo. */
  const [editando, setEditando] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<string[]>([]);
  /** Sube cada vez que hay lotes nuevos (propios o de otro teléfono). */
  const [novedades, setNovedades] = useState(0);
  const marcasVistas = useRef<number | null>(null);
  /**
   * La base tiene lo necesario para vencimiento, historial y "desde 0".
   * Mientras no, esas partes no se muestran (se guardarían en el aire).
   */
  const [extras, setExtras] = useState(false);
  /** Todo lo ya guardado en este inventario (todos los teléfonos), por producto. */
  const [yaEscaneados, setYaEscaneados] = useState<ProductoContado[]>([]);
  const contadosRef = useRef<Map<string, ProductoContado>>(new Map());

  const [lineas, setLineas] = useState<Linea[]>([]);
  const [query, setQuery] = useState("");
  const [creando, setCreando] = useState<{ barcode: string; name: string } | null>(null);
  const buscadorRef = useRef<HTMLInputElement>(null);
  const antirebote = useRef(crearAntirebote(600));
  const borradorCargado = useRef(false);
  /**
   * Espejo de la sesión activa para poder consultarla desde `agregar`, que se
   * define antes de que se resuelva cuál es (y no debería depender del orden).
   */
  const sessionIdRef = useRef<string | null>(null);
  /** Espejo de la lista sin guardar, para saber si un producto ya está en ella. */
  const lineasRef = useRef<Linea[]>([]);
  lineasRef.current = lineas;

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
  const cargarProgreso = useCallback(async (): Promise<CountProgress | null | undefined> => {
    try {
      const url = currentBranch?.id
        ? `/api/inventario/conteo?branchId=${encodeURIComponent(currentBranch.id)}`
        : "/api/inventario/conteo";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo leer el conteo");

      const sesion = (data.session ?? null) as CountProgress | null;
      setProgreso(sesion);
      setExtras(data.extras === true);
      setSinConexion(false);

      // El servidor manda: si allá el conteo se cerró, se olvida acá también.
      recordarSesion(sesion && sesion.status === "OPEN" ? sesion : null);
      setSesionRecordada(
        sesion && sesion.status === "OPEN"
          ? { sessionId: sesion.sessionId, openedAt: sesion.openedAt, openedBy: sesion.openedBy }
          : null
      );
      return sesion;
    } catch {
      // Sin red no se sabe el progreso, pero sí con qué conteo se estaba
      // trabajando: se sigue escaneando y el outbox lo entrega al volver.
      setProgreso(null);
      setSinConexion(true);
      return undefined;
    } finally {
      setCargando(false);
    }
  }, [currentBranch?.id, recordarSesion]);

  useEffect(() => {
    void cargarProgreso();
  }, [cargarProgreso]);

  const abrirConteo = async () => {
    setAbriendo(true);
    try {
      const res = await fetch("/api/inventario/conteo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: currentBranch?.id ?? null,
          applyMode: "ON_CLOSE",
          startMode: inicio,
          openedBy: quien,
        }),
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
          ? "Ya había un inventario abierto: seguimos con ese"
          : inicio === "ZERO"
            ? "Modo inventario iniciado desde 0"
            : "Modo inventario iniciado",
        "success"
      );
      void refrescarCatalogo();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo abrir el conteo", "error");
    } finally {
      setAbriendo(false);
    }
  };

  // ── Armado de la lista ────────────────────────────────────────────
  const agregar = useCallback(
    (product: ProductUI, cantidad?: number, vence?: string) => {
      const barcode = product.barcode || product.id;
      const paso = product.byWeight ? 0.5 : 1;
      // Se mira en el espejo y no dentro del actualizador: React puede
      // ejecutarlo después, y entonces la consulta de abajo no salía nunca.
      const esNueva = !lineasRef.current.some((l) => l.barcode === barcode);
      // Lo que ya se guardó de este producto en el inventario, según la lista
      // que la pantalla mantiene al día: el aviso sale al instante, sin red.
      const previo = esNueva ? contadosRef.current.get(barcode) : undefined;
      if (previo && previo.total > 0) {
        showToast(
          `${product.name}: YA SE CONTARON ${previo.total} (` +
            previo.porPersona.map((x) => `${x.por} ${x.qty}`).join(" + ") +
            "). Lo que cuentes ahora se SUMA. Si es el mismo lugar, toca Corregir.",
          "warning",
          7000
        );
      }

      setLineas((prev) => {
        const idx = prev.findIndex((l) => l.barcode === barcode);
        if (idx === -1) {
          return [
            {
              barcode,
              name: product.name,
              qty: cantidad ?? paso,
              sistema: Number(product.stock ?? 0),
              yaContado: previo ? previo.total : null,
              porPersona: previo?.porPersona,
              reemplazar: false,
              byWeight: Boolean(product.byWeight),
              price: Number(product.price ?? 0),
              expiry: vence ?? "",
            },
            ...prev,
          ];
        }
        // Volver a escanear el mismo producto suma una unidad: así se cuenta
        // una góndola, pasando el lector por cada envase.
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          qty: next[idx].qty + (cantidad ?? paso),
          ...(vence ? { expiry: vence } : {}),
        };
        return next;
      });

      // Si este producto ya se contó en otro lugar del recorrido, hay que
      // decirlo: es la confusión que hizo perder conteos la primera vez.
      if (esNueva && sessionIdRef.current) {
        void (async () => {
          try {
            const res = await fetch(
              `/api/inventario/conteo/producto?sessionId=${encodeURIComponent(
                sessionIdRef.current!
              )}&barcode=${encodeURIComponent(barcode)}`,
              { cache: "no-store" }
            );
            if (!res.ok) return;
            const data = (await res.json()) as {
              contado?: number;
              porPersona?: Array<{ por: string; qty: number }>;
            };
            const contado = Number(data.contado ?? 0);
            if (contado <= 0) return;
            setLineas((prev) =>
              prev.map((l) =>
                l.barcode === barcode
                  ? { ...l, yaContado: contado, porPersona: data.porPersona ?? [] }
                  : l
              )
            );
          } catch {
            /* sin red queda lo que se sabía: sumar no necesita el total previo */
          }
        })();
      }
    },
    [showToast]
  );

  const onDetected = useCallback(
    async (code: string, source?: string) => {
      const limpio = code.trim();
      if (!limpio) return;

      // Anti-rebote solo para la cámara (lee el mismo código varias veces en
      // el mismo destello). El láser no rebota: contar una góndola es pasar
      // el mismo código muchas veces seguidas y cada lectura es una unidad.
      if (antirebote.current(limpio, source ?? "laser")) return;

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
            showToast(
              `${data.producto.name} — estaba fuera del catálogo, contarlo lo reactiva`,
              "success"
            );
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
    if (q.length < 2) {
      setResultadosInactivos([]);
      return;
    }

    let cancelado = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/inventario/buscar?q=${encodeURIComponent(q)}&inactivos=1`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { productos?: ProductUI[] };
        if (cancelado) return;
        // Sólo lo que el catálogo local (activos) no trae ya.
        const enCatalogo = new Set(catalogo.map((c) => c.id));
        setResultadosInactivos(
          (data.productos ?? []).filter((p) => !enCatalogo.has(p.id)).slice(0, SEARCH_RESULTS_LIMIT)
        );
      } catch {
        /* sin red no hay nada que sumar a lo local */
      }
    }, 350);

    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [query, catalogo]);

  const fijarCantidad = (barcode: string, qty: number) => {
    setLineas((prev) =>
      prev.map((l) => (l.barcode === barcode ? { ...l, qty: Math.max(0, qty) } : l))
    );
  };

  const fijarVencimiento = (barcode: string, expiry: string) => {
    setLineas((prev) => prev.map((l) => (l.barcode === barcode ? { ...l, expiry } : l)));
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

  useEffect(() => {
    sessionIdRef.current = sessionIdActivo;
  }, [sessionIdActivo]);

  // ── Los otros teléfonos ───────────────────────────────────────────
  // Todos cuentan sobre la misma sesión: cada tantos segundos se trae el
  // avance para ver lo que guardaron los demás (y si alguien la cerró).
  useEffect(() => {
    if (!sessionIdActivo) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void cargarProgreso();
    }, SONDEO_MS);
    return () => window.clearInterval(id);
  }, [sessionIdActivo, cargarProgreso]);

  useEffect(() => {
    const marcas = sesionAbierta?.marcas ?? null;
    if (marcas === null) return;
    if (marcasVistas.current !== null && marcasVistas.current !== marcas) setNovedades((n) => n + 1);
    marcasVistas.current = marcas;
  }, [sesionAbierta?.marcas]);

  // Lo ya escaneado se recarga al entrar al inventario y cada vez que cambia
  // el número de marcas guardadas (propias o de otro teléfono).
  const cargarContados = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(
        `/api/inventario/conteo/contados?sessionId=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { productos?: ProductoContado[] };
      const lista = data.productos ?? [];
      contadosRef.current = new Map(lista.map((p) => [p.barcode, p]));
      setYaEscaneados(lista);
      // Las líneas sin guardar se ponen al día con lo que guardaron los demás.
      setLineas((prev) =>
        prev.map((l) => {
          const c = contadosRef.current.get(l.barcode);
          return c ? { ...l, yaContado: c.total, porPersona: c.porPersona } : l;
        })
      );
    } catch {
      /* sin red queda la última lista */
    }
  }, []);

  useEffect(() => {
    if (sessionIdActivo && !sinConexion) void cargarContados(sessionIdActivo);
  }, [sessionIdActivo, sinConexion, sesionAbierta?.marcas, cargarContados]);

  /** "Corregir" desde la lista de ya escaneados: a la lista, para reemplazar. */
  const corregirContado = (c: ProductoContado) => {
    const producto = catalogo.find((p) => (p.barcode || p.id) === c.barcode);
    setLineas((prev) => {
      const idx = prev.findIndex((l) => l.barcode === c.barcode);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: c.total, reemplazar: true, yaContado: c.total, porPersona: c.porPersona };
        return next;
      }
      return [
        {
          barcode: c.barcode,
          name: c.name,
          qty: c.total,
          sistema: Number(producto?.stock ?? 0),
          yaContado: c.total,
          porPersona: c.porPersona,
          reemplazar: true,
          byWeight: Boolean(producto?.byWeight),
          price: Number(producto?.price ?? 0),
          expiry: "",
        },
        ...prev,
      ];
    });
    showToast(`${c.name}: escribe la cantidad REAL y guarda. Reemplaza los ${c.total} contados.`, "info", 6000);
  };

  // La ficha completa necesita las categorías; se piden una vez.
  useEffect(() => {
    if (editando && categorias.length === 0) {
      void fetchCategorias().then(setCategorias).catch(() => {});
    }
  }, [editando, categorias.length]);

  // ── Guardar lo contado ────────────────────────────────────────────
  const guardar = async () => {
    if (lineas.length === 0 || !sessionIdActivo) return;
    setGuardando(true);
    try {
      await enviarLote(sessionIdActivo, true);
    } finally {
      setGuardando(false);
    }
  };

  /**
   * Manda la lista a `sessionId`. Si otro teléfono cerró ese inventario
   * mientras se contaba, la lista NO se pierde: se busca el inventario abierto
   * de ahora y, si hay uno, el lote se manda ahí (una sola vez).
   */
  const enviarLote = async (sessionId: string, reintentar: boolean): Promise<void> => {
    {
      const res = await apiWrite<{
        aplicados: number;
        ajustados: number;
        desconocidos: string[];
        soloAnotado: boolean;
        sumados: number;
      }>({
        kind: "count",
        url: "/api/inventario/conteo/items",
        // Deduplicación en la base. Además la cantidad es absoluta, así que
        // reenviar el lote no puede sumar dos veces ni con el opId perdido.
        idField: "opId",
        payload: {
          items: lineas.map((l) => ({
            barcode: l.barcode,
            qty: l.qty,
            replace: l.reemplazar,
            ...(extras && l.expiry ? { expiry: l.expiry } : {}),
          })),
          // Quién cuenta en este teléfono: el lote queda a su nombre.
          countedBy: quien,
          sessionId,
          branchId: currentBranch?.id ?? null,
        },
      });

      if (res.ok && res.queued) {
        showToast("Lote guardado sin conexión — se sincronizará", "success");
        setLineas([]);
        await refreshPending();
        return;
      }

      if (!res.ok) {
        if (/cerrad/i.test(res.error ?? "")) {
          const actual = await cargarProgreso();
          if (reintentar && actual && actual.status === "OPEN" && actual.sessionId !== sessionId) {
            showToast("Otro teléfono cerró el inventario anterior: guardando en el que está abierto…", "info");
            await enviarLote(actual.sessionId, false);
            return;
          }
          showToast(
            `Otro teléfono cerró el inventario. Tus ${lineas.length} productos siguen aquí: ` +
              "inicia el modo inventario y guárdalos.",
            "error",
            8000
          );
          return;
        }
        showToast(res.error, "error");
        return;
      }

      const desconocidos = res.data?.desconocidos ?? [];
      const cuantos = res.data?.aplicados ?? lineas.length;
      const sumados = res.data?.sumados ?? 0;
      showToast(
        (res.data?.soloAnotado
          ? `Lote guardado: ${cuantos} productos — el stock se aplica al cerrar`
          : `${cuantos} productos contados`) +
          (sumados > 0 ? ` · ${sumados} se sumaron a lo ya contado` : "") +
          (desconocidos.length > 0 ? ` · ${desconocidos.length} sin catálogo` : ""),
        "success"
      );
      setLineas([]);
      await cargarProgreso();
      void refrescarCatalogo();
    }
  };

  // ── Cerrar el conteo ──────────────────────────────────────────────
  const cerrar = async (modoCierre: ModoCierre, esperadoPendientes?: number) => {
    if (!sesionAbierta) return;
    if (lineas.length > 0) {
      showToast("Guarda primero lo que tienes en la lista", "error");
      return;
    }

    setCerrando(true);
    try {
      const res = await fetch("/api/inventario/conteo/cerrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sesionAbierta.sessionId,
          modo: modoCierre,
          ...(modoCierre === "todo" ? { esperadoPendientes } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          showToast(
            `El conteo cambió mientras confirmabas (ahora ${data.actual} sin contar). Revisa y vuelve a intentar.`,
            "error",
            8000
          );
          await cargarProgreso();
          return;
        }
        throw new Error(data.error || "No se pudo cerrar el conteo");
      }

      showToast(
        `Inventario cerrado: ${data.contados} contados` +
          (data.corregidos > 0 ? `, ${data.corregidos} corregidos por ventas` : "") +
          (modoCierre === "todo"
            ? `, ${data.puestosEnCero} puestos en 0, ${data.desactivados} fuera del catálogo`
            : ". Lo no escaneado quedó igual"),
        "success",
        6000
      );
      if (data.enNegativo > 0) {
        // Se vendió más de lo que se contó: o el conteo de ese producto ya
        // estaba viejo, o alguien vendió sin stock. Quedaron en 0.
        showToast(
          `${data.enNegativo} productos se vendieron más de lo contado y quedaron en 0. Vale la pena recontarlos.`,
          "info",
          8000
        );
      }
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

  // Ficha completa de un producto (editar nombre, precio, categoría…).
  if (editando) {
    return (
      <FichaProducto
        key={editando}
        barcode={editando}
        esAdmin={esAdmin}
        branchId={currentBranch?.id ?? null}
        categorias={categorias}
        onClose={(resultado) => {
          if (resultado) {
            const p = resultado.producto;
            upsertLocal(p);
            setLineas((prev) =>
              prev.map((l) =>
                l.barcode === editando ? { ...l, name: p.name, price: p.price, byWeight: Boolean(p.byWeight) } : l
              )
            );
          }
          setEditando(null);
        }}
        onAbrirOtro={() => {}}
        onCodigoCambiado={(nuevo, anterior) => {
          setLineas((prev) => prev.map((l) => (l.barcode === anterior ? { ...l, barcode: nuevo } : l)));
          void refrescarCatalogo();
          setEditando(null);
        }}
      />
    );
  }

  if (!sessionIdActivo) {
    return (
      <div className="max-w-2xl mx-auto p-5 space-y-5">
        {sinConexion && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-xs text-amber-200/80 leading-relaxed">
              Sin conexión y sin un inventario empezado en este teléfono. El modo inventario se
              inicia con red; después se puede seguir escaneando sin ella.
            </p>
          </div>
        )}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-400">
              <ClipboardDocumentCheckIcon className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase italic tracking-tight">Inventario</h1>
              <p className="text-sm text-white/40">
                {currentBranch?.name ?? "Sucursal principal"}
              </p>
            </div>
          </div>

          <div className="space-y-3 text-sm text-white/60 leading-relaxed">
            <p>
              Al iniciar se abre <strong className="text-white">una sola sesión para todos los
              teléfonos</strong>. Cada persona escanea, cuenta y guarda sus lotes con su nombre, y lo
              que cuenten del mismo producto <strong className="text-white">se suma</strong>.
            </p>
            <p>
              El stock se aplica al cerrar el inventario, descontando lo que se venda mientras
              tanto: se puede contar con la tienda abierta.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
              Cómo empieza
            </legend>

            <label
              className={`flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition-colors ${
                inicio === "KEEP" ? "border-emerald-500/50 bg-emerald-500/10" : "border-white/10 bg-white/5"
              }`}
            >
              <input
                type="radio"
                name="inicio-inventario"
                checked={inicio === "KEEP"}
                onChange={() => setInicio("KEEP")}
                className="mt-0.5 w-4 h-4 accent-emerald-500"
              />
              <span className="text-xs leading-relaxed">
                <strong className="text-white">Mantener el inventario actual</strong>
                <br />
                <span className="text-white/50">
                  Solo cambia lo que se escanee. Lo que no se cuente queda como está. Sirve para
                  una góndola o un recuento parcial.
                </span>
              </span>
            </label>

            <label
              className={`flex items-start gap-3 rounded-2xl border p-3 transition-colors ${
                esAdmin && extras ? "cursor-pointer" : "opacity-50"
              } ${inicio === "ZERO" ? "border-amber-500/50 bg-amber-500/10" : "border-white/10 bg-white/5"}`}
            >
              <input
                type="radio"
                name="inicio-inventario"
                checked={inicio === "ZERO"}
                disabled={!esAdmin || !extras}
                onChange={() => setInicio("ZERO")}
                className="mt-0.5 w-4 h-4 accent-amber-500"
              />
              <span className="text-xs leading-relaxed">
                <strong className="text-white">Empezar desde 0</strong>
                {!esAdmin && <span className="text-white/50"> · solo administrador</span>}
                <br />
                <span className="text-white/50">
                  Inventario completo de la tienda: todo parte en 0 y solo queda con stock lo que
                  se cuente. Lo no contado pasa a 0 al cerrar, no antes, así la tienda sigue
                  vendiendo mientras tanto.
                </span>
              </span>
            </label>
          </fieldset>

          <p className="text-xs text-white/50">
            Cuenta en este teléfono:{" "}
            <strong className="text-white">{quien ?? "sin elegir"}</strong>
            {!attendant && " — elige quién atiende arriba para que tus lotes queden a tu nombre."}
          </p>

          <button
            onClick={abrirConteo}
            disabled={abriendo || sinConexion}
            className="w-full h-14 rounded-2xl bg-emerald-500 text-black text-sm font-black uppercase tracking-widest disabled:bg-white/10 disabled:text-white/40"
          >
            {abriendo ? "Iniciando…" : "Iniciar modo inventario"}
          </button>
        </div>

        {extras && <InventariosAnteriores branchId={currentBranch?.id ?? null} />}
      </div>
    );
  }

  // ── Conteo en curso ───────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase italic tracking-tight">
            Inventario <span className="text-emerald-400 not-italic text-xs align-middle">● en curso</span>
          </h1>
          <p className="text-[11px] text-white/40">
            {(() => {
              const abierto = sesionAbierta?.openedAt ?? sesionRecordada?.openedAt;
              const por = sesionAbierta?.openedBy ?? sesionRecordada?.openedBy;
              return `Cuenta ${quien ?? "sin nombre"} · abierto ${abierto ? new Date(abierto).toLocaleString("es-CL") : "—"}${
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

      {/* Qué está pasando con el stock mientras se cuenta. Es la duda que
          aparece sola: "¿ya cambié el inventario?". */}
      {sesionAbierta?.applyMode === "ON_CLOSE" && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs text-white/50 leading-relaxed">
            <strong className="text-white">El stock no se toca todavía.</strong> La tienda sigue
            vendiendo con sus números y todo se aplica al cerrar el inventario, descontando lo que
            se venda de aquí en adelante.{" "}
            {sesionAbierta.startMode === "ZERO"
              ? "Este inventario parte desde 0: lo que no se cuente queda en 0 al cerrar."
              : "Se mantiene el inventario actual: solo cambia lo escaneado."}
            {sesionAbierta.movidosDesdeElConteo > 0 && (
              <>
                {" "}
                Ya hay{" "}
                <strong className="text-white">{sesionAbierta.movidosDesdeElConteo}</strong>{" "}
                {sesionAbierta.movidosDesdeElConteo === 1 ? "producto" : "productos"} con
                movimiento después de contarse: se corrigen solos al cerrar.
              </>
            )}
          </p>
          {sesionAbierta.enVariosLugares > 0 && (
            <p className="text-xs text-white/50 leading-relaxed mt-2">
              <strong className="text-white">{sesionAbierta.enVariosLugares}</strong>{" "}
              {sesionAbierta.enVariosLugares === 1 ? "producto contado" : "productos contados"} en
              más de un lugar: las cantidades se suman.
            </p>
          )}
        </div>
      )}

      {sesionAbierta?.applyMode === "LIVE" && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs text-amber-200/80 leading-relaxed">
            Conteo <strong>al instante</strong>: cada vez que guardas, el stock queda en lo
            contado. Si alguien vende mientras cuentas, esa venta se pierde.
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
                      {contadosRef.current.has(p.barcode || p.id) && (
                        <span className="text-amber-300 font-black">
                          {" "}· ya contado {contadosRef.current.get(p.barcode || p.id)!.total}
                        </span>
                      )}
                    </p>
                  </div>
                </button>
              </li>
            ))}
            {resultadosInactivos.map((p) => (
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

            <li className="py-3 text-center">
              <p className="text-xs text-white/30 mb-2">
                {resultados.length + resultadosInactivos.length > 0
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
            puedes escribir la cantidad, anotar el vencimiento y revisar el precio. Al terminar un
            lote, guárdalo.
          </p>
        ) : (
          <ul className="space-y-2">
            {lineas.map((l) => {
              const paso = l.byWeight ? 0.5 : 1;
              const diferencia = l.qty - l.sistema;
              const yaContado = (l.yaContado ?? 0) > 0;
              const desdeCero = sesionAbierta?.startMode === "ZERO";
              return (
                <li
                  key={l.barcode}
                  className="bg-white/5 border border-white/5 rounded-2xl p-3 flex flex-col sm:flex-row gap-3 sm:items-center"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-sm uppercase tracking-tight truncate">{l.name}</p>
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mt-0.5">
                      {l.barcode}
                      {!desdeCero && ` · sistema ${l.sistema}`}
                      {!desdeCero && !yaContado && diferencia !== 0 && (
                        <span className={diferencia < 0 ? "text-red-400" : "text-emerald-400"}>
                          {" "}
                          ({diferencia > 0 ? "+" : ""}
                          {l.byWeight ? diferencia.toFixed(2) : diferencia})
                        </span>
                      )}
                    </p>

                    {/* Ya contado en otro lugar del recorrido. Es la confusión
                        que hizo perder 121 conteos la primera vez: acá se dice
                        en qué va a quedar el total y se ofrece corregir. */}
                    {yaContado && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-amber-300">
                          {l.reemplazar
                            ? `Reemplaza los ${l.yaContado} ya contados`
                            : `${
                                l.porPersona && l.porPersona.length > 0
                                  ? l.porPersona.map((x) => `${x.por} ${x.qty}`).join(" + ")
                                  : `Ya contado ${l.yaContado}`
                              } · total ${
                                l.byWeight
                                  ? (l.yaContado! + l.qty).toFixed(2)
                                  : l.yaContado! + l.qty
                              }`}
                        </span>
                        <button
                          onClick={() =>
                            setLineas((prev) =>
                              prev.map((x) =>
                                x.barcode === l.barcode ? { ...x, reemplazar: !x.reemplazar } : x
                              )
                            )
                          }
                          className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border transition-colors ${
                            l.reemplazar
                              ? "border-amber-500/60 bg-amber-500/20 text-amber-200"
                              : "border-white/10 bg-white/5 text-white/40"
                          }`}
                        >
                          {l.reemplazar ? "Corrigiendo" : "Corregir"}
                        </button>
                      </div>
                    )}

                    {/* Lo que se revisa al contar: precio de venta y vencimiento. */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setPrecioDe(l)}
                        className={`min-h-11 px-3 rounded-xl border text-xs font-black tabular-nums ${
                          (l.price ?? 0) > 0
                            ? "border-white/10 bg-white/5 text-white"
                            : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                        }`}
                      >
                        {(l.price ?? 0) > 0
                          ? `$${(l.price ?? 0).toLocaleString("es-CL")}${l.byWeight ? "/kg" : ""}`
                          : "Sin precio"}
                      </button>
                      {extras && (
                      <label className="min-h-11 px-3 rounded-xl border border-white/10 bg-white/5 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/40">
                        Vence
                        <input
                          type="date"
                          value={l.expiry ?? ""}
                          onChange={(e) => fijarVencimiento(l.barcode, e.target.value)}
                          aria-label={`Vencimiento de ${l.name}`}
                          className="bg-transparent text-white text-xs font-bold outline-none [color-scheme:dark]"
                        />
                      </label>
                      )}
                      <button
                        onClick={() => setEditando(l.barcode)}
                        aria-label={`Editar ${l.name}`}
                        className="min-h-11 min-w-11 px-3 rounded-xl border border-white/10 bg-white/5 text-white/60 flex items-center justify-center"
                      >
                        <PencilSquareIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2">
                    <div className="flex items-center gap-1 bg-black/40 p-1.5 rounded-2xl border border-white/5">
                      <button
                        onClick={() => fijarCantidad(l.barcode, l.qty - paso)}
                        aria-label="Restar"
                        className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center active:scale-90 transition-transform"
                      >
                        <MinusIcon className="w-4 h-4" />
                      </button>
                      <QtyInput
                        value={l.qty}
                        porPeso={l.byWeight}
                        permitirCero
                        onChange={(q) => fijarCantidad(l.barcode, q)}
                        aria-label={`Cantidad contada de ${l.name}`}
                        className="w-16 h-12 bg-transparent text-center text-lg font-black tabular-nums outline-none rounded-xl focus:bg-white/10"
                      />
                      <button
                        onClick={() => fijarCantidad(l.barcode, l.qty + paso)}
                        aria-label="Sumar"
                        className="w-12 h-12 rounded-xl bg-white text-black flex items-center justify-center active:scale-90 transition-transform"
                      >
                        <PlusIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      onClick={() => quitar(l.barcode)}
                      aria-label="Quitar de la lista"
                      className="w-12 h-12 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center active:scale-90"
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
        {guardando ? "Guardando…" : `Guardar lote (${lineas.length})`}
      </button>

      {sessionIdActivo && !sinConexion && (
        <YaEscaneados productos={yaEscaneados} onCorregir={corregirContado} />
      )}

      {sessionIdActivo && !sinConexion && extras && (
        <HistorialInventario sessionId={sessionIdActivo} refrescar={novedades} />
      )}

      {/* Cierre: por defecto aplica solo lo escaneado (conteo de góndola). */}
      {sesionAbierta && (
        <CierreConteo
          resumen={{ ...sesionAbierta, esSucursal: currentBranch?.is_default === false }}
          esAdmin={esAdmin}
          hayLineasSinGuardar={lineas.length > 0}
          cerrando={cerrando}
          onCerrar={(m, esperado) => void cerrar(m, esperado)}
        />
      )}

      {creando && (
        <SinCoincidencia
          initialBarcode={creando.barcode}
          initialName={creando.name}
          products={catalogo}
          esAdmin={esAdmin}
          conVencimiento={extras}
          onClose={() => setCreando(null)}
          onListo={(product, datos, codigoAnterior) => {
            if (codigoAnterior) {
              // Lo que ya estaba en la lista con el código genérico pasa al real.
              setLineas((prev) =>
                prev.map((l) => (l.barcode === codigoAnterior ? { ...l, barcode: product.barcode || product.id } : l))
              );
            }
            upsertLocal(product);
            agregar(product, datos.qty, datos.expiry);
            setCreando(null);
            setQuery("");
            void refrescarCatalogo();
          }}
        />
      )}

      {precioDe && (
        <PriceSheet
          modo={(precioDe.price ?? 0) > 0 ? "corregir" : "sin-precio"}
          product={
            catalogo.find((p) => (p.barcode || p.id) === precioDe.barcode) ??
            ({ id: precioDe.barcode, barcode: precioDe.barcode, name: precioDe.name, price: precioDe.price ?? 0 } as ProductUI)
          }
          onCancel={() => setPrecioDe(null)}
          onSaved={(p) => {
            upsertLocal(p);
            setLineas((prev) => prev.map((l) => (l.barcode === precioDe.barcode ? { ...l, price: p.price } : l)));
            showToast(`${p.name}: $${p.price.toLocaleString("es-CL")}`, "success");
            setPrecioDe(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Inventarios anteriores de la sucursal, con su historial de lotes. Nada se
 * borra al cerrar: cada inventario queda consultable.
 */
function InventariosAnteriores({ branchId }: { branchId: string | null }) {
  const [sesiones, setSesiones] = useState<
    Array<{ sessionId: string; status: string; openedAt: string; openedBy: string | null; closedAt: string | null }>
  >([]);
  const [ver, setVer] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/inventario/conteo/historial${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { sesiones?: typeof sesiones };
        if (!cancelado) setSesiones((data.sesiones ?? []).filter((x) => x.status === "CLOSED"));
      } catch {
        /* sin red no hay historial que mostrar */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [branchId]);

  if (sesiones.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 italic px-1">
        Inventarios anteriores
      </p>
      <ul className="space-y-2">
        {sesiones.map((x) => (
          <li key={x.sessionId} className="space-y-2">
            <button
              onClick={() => setVer(ver === x.sessionId ? null : x.sessionId)}
              aria-expanded={ver === x.sessionId}
              className="w-full min-h-12 px-4 py-2 rounded-2xl border border-white/10 bg-white/5 text-left"
            >
              <span className="block text-xs font-black text-white">
                {fechaCorta(x.openedAt.slice(0, 10))}
                {x.openedBy ? ` · ${x.openedBy}` : ""}
              </span>
              <span className="block text-[10px] text-white/40">
                Cerrado {x.closedAt ? new Date(x.closedAt).toLocaleString("es-CL") : "—"}
              </span>
            </button>
            {ver === x.sessionId && <HistorialInventario sessionId={x.sessionId} abiertoAlInicio />}
          </li>
        ))}
      </ul>
    </div>
  );
}
