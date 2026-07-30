"use client";

import React from "react";
import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/contexts/ToastContext";
import { BranchProvider } from "@/contexts/BranchContext";
import { SyncProvider } from "@/contexts/SyncContext";

/**
 * Providers globales. Van en un client component aparte para que el layout
 * raíz siga siendo server component.
 *
 * Orden: Toast primero (los demás muestran avisos), luego Branch (la sucursal
 * activa la necesitan venta y recepción) y por último Sync, que monta el
 * drenaje del outbox offline una sola vez para toda la app.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <BranchProvider>
          <SyncProvider>{children}</SyncProvider>
        </BranchProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
