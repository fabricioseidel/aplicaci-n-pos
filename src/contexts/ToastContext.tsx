"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import Toast, { ToastType } from "@/components/ui/Toast";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const handleClose = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info", duration: number = 4000) => {
      const id = Date.now() + Math.random();
      // Máximo 3 en pantalla: durante una venta rápida se encadenan muchos
      // "+ producto" y tapar el carrito con avisos es peor que perderlos.
      // Los "+ producto" de una venta rápida se reemplazan entre sí en vez de
      // apilarse: tres avisos encima tapaban el total y el botón de cobrar.
      setToasts((prev) => {
        const base = message.startsWith("+ ") ? prev.filter((t) => !t.message.startsWith("+ ")) : prev;
        const next = [...base, { id, message, type, duration }];
        return next.length > 2 ? next.slice(next.length - 2) : next;
      });
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-24 sm:top-auto sm:bottom-8 right-0 sm:right-8 z-[100] pointer-events-none flex flex-col items-center sm:items-end gap-2 px-4 w-full sm:w-auto">
        {toasts.map((t) => (
          <Toast
            key={t.id}
            message={t.message}
            type={t.type}
            duration={t.duration}
            onClose={() => handleClose(t.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
}
