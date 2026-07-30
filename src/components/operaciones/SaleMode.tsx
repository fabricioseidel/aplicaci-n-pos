"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { usePOS, unitPriceOf, lineSubtotal } from "@/contexts/POSContext";
import { useBranch } from "@/contexts/BranchContext";
import { useToast } from "@/contexts/ToastContext";
import { useSync } from "@/contexts/SyncContext";
import { useProductCatalog } from "@/hooks/useProductCatalog";
import { ProductUI } from "@/types";
import { STAFF_DISCOUNT_RATE, type PosPaymentMethod } from "@/lib/pos/payments";
import { apiWrite } from "@/lib/offline/apiWrite";
import { newId } from "@/lib/offline/db";
import UnifiedScanner from "@/components/scanner/UnifiedScanner";
import QuickCreateProductModal from "@/components/operaciones/QuickCreateProductModal";
import WeightPrompt from "@/components/operaciones/WeightPrompt";
import {
  MagnifyingGlassIcon, XMarkIcon, TrashIcon, MinusIcon, PlusIcon,
  BanknotesIcon, CreditCardIcon, ArrowPathIcon, CheckCircleIcon,
  ShoppingBagIcon, CameraIcon, PlusCircleIcon, ScaleIcon, CloudArrowUpIcon,
} from "@heroicons/react/24/outline";

const PRODUCTS_PER_PAGE = 40;

type PaymentMethod = PosPaymentMethod;

interface PaymentRow {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transf.",
};

const METHOD_ICONS: Record<PaymentMethod, typeof BanknotesIcon> = {
  CASH: BanknotesIcon, CARD: CreditCardIcon, TRANSFER: ArrowPathIcon,
};

interface SaleModeProps {
  /** Turno abierto en el que se registrarán las ventas. */
  shiftId: string | null;
}

export default function SaleMode({ shiftId }: SaleModeProps) {
  const { cart, addToCart, setQuantity, removeFromCart, clearCart, total } = usePOS();
  const { currentBranch } = useBranch();
  const { showToast } = useToast();
  const { refreshPending } = useSync();
  const { products: allProducts, loading, fromCache, upsertLocal } = useProductCatalog();

  const [searchQuery, setSearchQuery] = useState("");
  const [payments, setPayments] = useState<PaymentRow[]>([{ id: "p1", method: "CASH", amount: 0 }]);
  const [processing, setProcessing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [quickCreateBarcode, setQuickCreateBarcode] = useState<string | null>(null);
  const [view, setView] = useState<"products" | "cart">("products");
  const [compraPropia, setCompraPropia] = useState(false);
  const [porCobrar, setPorCobrar] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PRODUCTS_PER_PAGE);
  /** Producto por peso esperando que el cajero ingrese los gramos. */
  const [weighing, setWeighing] = useState<{ product: ProductUI; initialKg?: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // El descuento de personal se recalcula cuando cambia el carrito para que
  // siga siendo el 25% del total vigente, no un monto congelado.
  const discount = useMemo(
    () => (compraPropia ? Math.round(total * STAFF_DISCOUNT_RATE) : 0),
    [compraPropia, total]
  );
  const finalTotal = Math.max(0, total - discount);

  const paymentSum = useMemo(
    () => payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0),
    [payments]
  );
  const remaining = useMemo(() => Math.max(0, finalTotal - paymentSum), [finalTotal, paymentSum]);
  const cashPaid = useMemo(
    () => payments.filter((p) => p.method === "CASH").reduce((a, p) => a + (Number(p.amount) || 0), 0),
    [payments]
  );
  const change = useMemo(() => {
    // El vuelto sólo aplica si hay sobrepago en efectivo.
    const nonCash = paymentSum - cashPaid;
    const cashOwed = Math.max(0, finalTotal - nonCash);
    return Math.max(0, cashPaid - cashOwed);
  }, [paymentSum, cashPaid, finalTotal]);

  // Una compra propia por cobrar no recibe dinero ahora: no hay pagos que cuadrar.
  const paymentsOk = porCobrar
    ? true
    : Math.abs(paymentSum - change - finalTotal) < 0.01 && paymentSum >= finalTotal;

  const products = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return q
      ? allProducts.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q))
      : allProducts;
  }, [searchQuery, allProducts]);
  const visibleProducts = useMemo(() => products.slice(0, visibleCount), [products, visibleCount]);

  useEffect(() => { setVisibleCount(PRODUCTS_PER_PAGE); }, [searchQuery]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setVisibleCount((p) => Math.min(p + PRODUCTS_PER_PAGE, products.length));
    }
  }, [products.length]);

  // Autorrellena el monto del primer pago cuando hay una sola fila.
  useEffect(() => {
    if (payments.length === 1 && finalTotal > 0 && payments[0].amount === 0) {
      setPayments([{ ...payments[0], amount: finalTotal }]);
    }
  }, [finalTotal, payments]);

  /**
   * Punto único de entrada al carrito. Un producto por peso no puede entrar
   * con cantidad 1: primero hay que preguntar cuánto pesa.
   */
  const pickProduct = useCallback((p: ProductUI) => {
    if (p.byWeight) {
      setWeighing({ product: p });
      return;
    }
    addToCart(p);
    showToast(`+ ${p.name}`, "success", 1200);
  }, [addToCart, showToast]);

  const setPaymentAt = (idx: number, patch: Partial<PaymentRow>) => {
    setPayments((p) => p.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };
  const addPaymentRow = () => {
    setPayments((p) => [...p, { id: `p${Date.now()}`, method: "CASH", amount: remaining }]);
  };
  const removePaymentRow = (idx: number) => {
    setPayments((p) => p.filter((_, i) => i !== idx));
  };

  const resetSale = () => {
    clearCart();
    setPayments([{ id: "p1", method: "CASH", amount: 0 }]);
    setCompraPropia(false);
    setPorCobrar(false);
    setView("products");
  };

  const handleCheckout = async () => {
    if (cart.length === 0 || processing) return;
    if (!paymentsOk) {
      showToast(remaining > 0 ? `Faltan $${remaining.toLocaleString()}` : "Pagos inválidos", "error");
      return;
    }
    setProcessing(true);
    try {
      // Con sobrepago, se ajusta la fila CASH para que la suma dé el total exacto.
      const nonCash = payments.filter((p) => p.method !== "CASH").reduce((a, p) => a + p.amount, 0);
      const cashApplied = Math.max(0, finalTotal - nonCash);
      const cashRowIdx = payments.findIndex((p) => p.method === "CASH");

      type PaymentPayload = { method: PaymentMethod; amount: number; reference?: string };

      const payloadPayments = payments
        .map((p, i): PaymentPayload | null => {
          if (p.method !== "CASH") {
            return { method: p.method, amount: p.amount, reference: p.reference };
          }
          // El sobrepago en efectivo se reparte sólo a la primera fila CASH;
          // las demás se descartan (raro, pero evita duplicar el vuelto).
          if (i === cashRowIdx) return { method: "CASH", amount: cashApplied };
          return null;
        })
        .filter((p): p is PaymentPayload => p !== null && p.amount > 0);

      // El id del cliente es la clave de idempotencia: si esta venta se encola
      // y se reintenta, apply_sale la deduplica por client_sale_id.
      const clientSaleId = newId();

      const result = await apiWrite({
        kind: "sale",
        url: "/api/sales",
        id: clientSaleId,
        payload: {
          clientSaleId,
          total: finalTotal,
          branchId: currentBranch?.id ?? null,
          // Se manda el turno vigente para que una venta sincronizada más
          // tarde quede en el turno en que realmente ocurrió.
          shiftId,
          cashReceived: porCobrar ? 0 : cashPaid,
          changeGiven: porCobrar ? 0 : change,
          tax: 0,
          discount: compraPropia ? discount : 0,
          isStaffPurchase: compraPropia,
          staffUnpaid: compraPropia && porCobrar,
          staffDiscountRate: compraPropia ? STAFF_DISCOUNT_RATE : undefined,
          ...(porCobrar ? {} : { payments: payloadPayments }),
          items: cart.map((item) => ({
            barcode: item.id,
            name: item.name,
            // Decimal para los productos por peso; entero para el resto.
            qty: item.quantity,
            unit_price: unitPriceOf(item),
            subtotal: lineSubtotal(item),
          })),
        },
      });

      if (result.ok && result.queued) {
        resetSale();
        await refreshPending();
        showToast("Venta guardada sin conexión — se sincronizará", "warning", 5000);
      } else if (result.ok) {
        resetSale();
        showToast("✓ Venta registrada", "success");
      } else {
        showToast(result.error || "Error en la venta", "error");
      }
    } catch (e) {
      showToast(`Error: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full">
      {/* Vista de productos */}
      <div className={view === "products" ? "block" : "hidden"}>
        <div className="p-3 flex gap-2 items-center border-b border-white/5 sticky top-[53px] md:top-0 bg-[#0a0a0a] z-20">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar producto..."
              data-laser-passthrough
              className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-9 pr-9 text-white text-sm outline-none focus:border-emerald-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white p-1"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowScanner(true)}
            aria-label="Escanear código"
            className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400"
          >
            <CameraIcon className="h-5 w-5" />
          </button>
          <button
            onClick={() => setView("cart")}
            aria-label="Ver carrito"
            className="relative p-2.5 bg-white/5 border border-white/10 rounded-xl text-white/70"
          >
            <ShoppingBagIcon className="h-5 w-5" />
            {cart.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 text-black text-[9px] font-black rounded-full flex items-center justify-center">
                {cart.length}
              </span>
            )}
          </button>
        </div>

        {fromCache && (
          <p className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-400 bg-amber-500/10 border-b border-amber-500/20">
            Catálogo sin conexión
          </p>
        )}

        <div
          className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 p-3 pb-24 content-start"
          onScroll={handleScroll}
          style={{ maxHeight: "calc(100vh - 10rem)", overflowY: "auto" }}
        >
          {loading && Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square bg-white/5 rounded-xl animate-pulse" />
          ))}

          {!loading && visibleProducts.map((p) => (
            <button
              key={p.id}
              disabled={p.stock <= 0}
              onClick={() => pickProduct(p)}
              className={`bg-white/5 rounded-xl p-2 border text-left transition-all active:scale-95 flex flex-col ${
                p.stock <= 0
                  ? "opacity-40 cursor-not-allowed border-white/5"
                  : "border-white/10 hover:border-emerald-500"
              }`}
            >
              <div className="relative aspect-square rounded-lg overflow-hidden mb-1 bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element -- imagen externa sin dimensiones conocidas */}
                <img src={p.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
                {p.byWeight && (
                  <span className="absolute top-1 left-1 flex items-center gap-0.5 rounded-md bg-black/70 px-1 py-0.5 text-[7px] font-black uppercase text-emerald-300">
                    <ScaleIcon className="h-2.5 w-2.5" /> kg
                  </span>
                )}
                {p.stock <= 0 && (
                  <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                    <span className="text-[8px] font-black text-red-400 uppercase">Sin stock</span>
                  </div>
                )}
              </div>
              <p className="text-[10px] font-bold truncate text-white/80">{p.name}</p>
              <p className="text-emerald-400 font-black text-xs">
                $ {unitPriceOf(p).toLocaleString()}
                {p.byWeight && <span className="text-[8px] text-white/40"> /kg</span>}
              </p>
            </button>
          ))}

          {!loading && visibleCount < products.length && (
            <div className="col-span-full py-3 text-center">
              <button
                onClick={() => setVisibleCount((p) => p + PRODUCTS_PER_PAGE)}
                className="text-[10px] font-bold uppercase tracking-widest text-emerald-500"
              >
                + {products.length - visibleCount} más
              </button>
            </div>
          )}

          {!loading && products.length === 0 && (
            <div className="col-span-full py-16 text-center text-white/30">
              <p className="text-xs font-black uppercase tracking-widest mb-3">Sin resultados</p>
              {searchQuery.trim() && (
                <button
                  onClick={() => setQuickCreateBarcode(searchQuery.trim())}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-[10px] font-black uppercase tracking-widest"
                >
                  <PlusCircleIcon className="h-4 w-4" /> Crear &quot;{searchQuery.trim()}&quot;
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Vista de carrito / cobro */}
      <div className={view === "cart" ? "block" : "hidden"}>
        <div className="p-3 flex items-center gap-3 border-b border-white/5 sticky top-[53px] md:top-0 bg-[#0a0a0a] z-20">
          <button
            onClick={() => setView("products")}
            className="text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white"
          >
            ← Productos
          </button>
          <span className="flex-1 text-[10px] font-black uppercase tracking-widest text-emerald-400 text-center">
            Carrito
          </span>
          <button onClick={clearCart} aria-label="Vaciar carrito" className="text-white/30 hover:text-red-400 transition-colors">
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="p-3 space-y-2 pb-6">
          {cart.length === 0 ? (
            <div className="py-16 flex flex-col items-center opacity-30">
              <ShoppingBagIcon className="h-12 w-12 mb-3" />
              <p className="text-xs font-black uppercase tracking-widest">Carrito vacío</p>
            </div>
          ) : cart.map((item) => (
            <div key={item.id} className="bg-white/5 rounded-2xl p-3 border border-white/5">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 min-w-0 pr-2">
                  <p className="text-sm font-bold truncate">{item.name}</p>
                  <p className="text-[10px] text-emerald-400 font-bold">
                    $ {unitPriceOf(item).toLocaleString()} {item.byWeight ? "por kg" : "c/u"}
                  </p>
                </div>
                <button
                  onClick={() => removeFromCart(item.id)}
                  aria-label={`Quitar ${item.name}`}
                  className="text-white/20 hover:text-red-400 transition-colors"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-between">
                {item.byWeight ? (
                  /* Por peso no hay stepper de +/-: se vuelve a pedir el peso. */
                  <button
                    onClick={() => setWeighing({ product: item, initialKg: item.quantity })}
                    className="flex items-center gap-1.5 bg-black/40 px-3 py-2 rounded-xl border border-emerald-500/30 text-emerald-300"
                  >
                    <ScaleIcon className="h-4 w-4" />
                    <span className="text-sm font-black">{item.quantity.toFixed(3)} kg</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/5">
                    <button
                      onClick={() => setQuantity(item.id, item.quantity - 1)}
                      aria-label="Quitar una unidad"
                      className="p-1.5 text-white/50 active:scale-90"
                    >
                      <MinusIcon className="h-3 w-3" />
                    </button>
                    <span className="w-8 text-center text-sm font-black">{item.quantity}</span>
                    <button
                      onClick={() => setQuantity(item.id, item.quantity + 1)}
                      aria-label="Agregar una unidad"
                      className="p-1.5 text-emerald-400 active:scale-90"
                    >
                      <PlusIcon className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <span className="text-sm font-black">$ {lineSubtotal(item).toLocaleString()}</span>
              </div>
            </div>
          ))}

          {cart.length > 0 && (
            <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-4 mt-4">
              {compraPropia && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                    Compra propia −{Math.round(STAFF_DISCOUNT_RATE * 100)}%
                  </span>
                  <span className="text-amber-400 font-black">- $ {discount.toLocaleString()}</span>
                </div>
              )}

              <div className="flex justify-between items-end">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Total</span>
                <span className="text-3xl font-black">$ {finalTotal.toLocaleString()}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  const activando = !compraPropia;
                  setCompraPropia(activando);
                  if (!activando) setPorCobrar(false);
                }}
                className={`w-full rounded-xl border px-4 py-3 text-[11px] font-black uppercase tracking-widest transition-colors ${
                  compraPropia
                    ? "bg-amber-500 border-amber-500 text-black"
                    : "bg-white/5 border-white/10 text-white/60 hover:text-white"
                }`}
              >
                {compraPropia ? "✓ Compra propia activa" : "Compra propia (−25%)"}
              </button>

              {compraPropia && (
                <label className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={porCobrar}
                    onChange={(e) => setPorCobrar(e.target.checked)}
                    className="h-4 w-4 accent-amber-500"
                  />
                  <span className="text-[11px] font-bold text-amber-200">
                    Dejar por cobrar (se descuenta del sueldo a fin de mes)
                  </span>
                </label>
              )}

              {/* Filas de pago — ocultas si la compra queda por cobrar: no entra
                  dinero a la caja, así que no hay nada que cuadrar. */}
              <div className={`space-y-2 ${porCobrar ? "hidden" : ""}`}>
                {payments.map((row, idx) => {
                  const Icon = METHOD_ICONS[row.method];
                  return (
                    <div key={row.id} className="flex gap-2 items-stretch">
                      <select
                        value={row.method}
                        onChange={(e) => setPaymentAt(idx, { method: e.target.value as PaymentMethod })}
                        aria-label="Método de pago"
                        className="bg-black border border-white/10 rounded-xl px-2 py-2 text-[10px] font-black uppercase tracking-widest text-white outline-none focus:border-emerald-500 shrink-0"
                      >
                        {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                          <option key={m} value={m}>{METHOD_LABEL[m]}</option>
                        ))}
                      </select>
                      <div className="relative flex-1">
                        <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder="0"
                          aria-label="Monto"
                          data-laser-passthrough
                          value={row.amount || ""}
                          onChange={(e) => setPaymentAt(idx, { amount: Number(e.target.value) || 0 })}
                          className="w-full bg-black border border-white/10 rounded-xl pl-8 pr-3 py-2 text-base font-black text-white outline-none focus:border-emerald-500"
                        />
                      </div>
                      {payments.length > 1 && (
                        <button
                          onClick={() => removePaymentRow(idx)}
                          aria-label="Quitar pago"
                          className="px-3 text-red-400 hover:bg-red-500/10 rounded-xl border border-red-500/20"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}

                <div className="flex gap-2 items-center">
                  <button
                    onClick={addPaymentRow}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-white/60"
                  >
                    <PlusCircleIcon className="h-3.5 w-3.5" /> Añadir pago
                  </button>
                  {payments.length === 1 && payments[0].method === "CASH" && (
                    <div className="flex gap-1 flex-1 justify-end">
                      {[1000, 2000, 5000, 10000].map((v) => (
                        <button
                          key={v}
                          onClick={() => setPaymentAt(0, { amount: v })}
                          className="text-[9px] font-bold py-1.5 px-2 rounded-lg bg-white/5 text-white/50 hover:bg-white/10"
                        >
                          ${v / 1000}k
                        </button>
                      ))}
                      <button
                        onClick={() => setPaymentAt(0, { amount: finalTotal })}
                        className="text-[9px] font-bold py-1.5 px-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20"
                      >
                        Exacto
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className={`flex justify-between items-center p-3 rounded-xl border text-sm ${
                remaining > 0 ? "bg-red-500/10 border-red-500/30 text-red-400" :
                change > 0 ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
                "bg-white/5 border-white/10 text-white/40"
              }`}>
                <span className="text-[10px] font-black uppercase tracking-widest">
                  {remaining > 0 ? "Falta" : change > 0 ? "Vuelto" : "Cuadrado"}
                </span>
                <span className="text-lg font-black">
                  $ {(remaining > 0 ? remaining : change).toLocaleString()}
                </span>
              </div>

              <button
                onClick={handleCheckout}
                disabled={cart.length === 0 || processing || !paymentsOk}
                className={`w-full h-14 rounded-2xl flex items-center justify-center gap-2 text-sm font-black uppercase tracking-widest transition-all ${
                  processing || !paymentsOk ? "bg-white/5 text-white/20" : "bg-emerald-500 text-black active:bg-emerald-600"
                }`}
              >
                {processing ? <ArrowPathIcon className="h-5 w-5 animate-spin" /> : (
                  <><CheckCircleIcon className="h-5 w-5" /> Confirmar Venta</>
                )}
              </button>

              <p className="flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-white/20">
                <CloudArrowUpIcon className="h-3.5 w-3.5" />
                Sin conexión la venta se guarda y se sincroniza sola
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Escáner */}
      {showScanner && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-md relative">
            <button
              onClick={() => setShowScanner(false)}
              aria-label="Cerrar escáner"
              className="absolute -top-12 right-0 p-2 bg-white/10 rounded-xl text-white hover:bg-red-500 transition-colors"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
            <UnifiedScanner
              onDetected={(barcode) => {
                const found = allProducts.find((p) => p.id === barcode || p.barcode === barcode);
                setShowScanner(false);
                if (found) {
                  pickProduct(found);
                } else {
                  showToast(`No encontrado: ${barcode}`, "error");
                  setQuickCreateBarcode(barcode);
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Peso para productos que se venden por kilo */}
      {weighing && (
        <WeightPrompt
          product={weighing.product}
          initialKg={weighing.initialKg}
          onCancel={() => setWeighing(null)}
          onConfirm={(kg) => {
            const inCart = cart.some((c) => c.id === weighing.product.id);
            if (inCart) {
              setQuantity(weighing.product.id, kg);
            } else {
              addToCart(weighing.product, kg);
            }
            showToast(`${weighing.product.name}: ${kg.toFixed(3)} kg`, "success", 1500);
            setWeighing(null);
          }}
        />
      )}

      {quickCreateBarcode !== null && (
        <QuickCreateProductModal
          initialBarcode={quickCreateBarcode}
          onClose={() => setQuickCreateBarcode(null)}
          onCreated={(product) => {
            upsertLocal(product);
            setQuickCreateBarcode(null);
            setSearchQuery("");
            pickProduct(product);
          }}
        />
      )}
    </div>
  );
}
