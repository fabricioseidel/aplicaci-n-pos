"use client";

import { useEffect } from "react";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastProps {
  type: ToastType;
  message: string;
  onClose: () => void;
  duration?: number;
}

const CONFIG = {
  success: { icon: CheckCircleIcon, color: "text-emerald-400", border: "border-emerald-500/30" },
  error: { icon: ExclamationCircleIcon, color: "text-red-400", border: "border-red-500/30" },
  warning: { icon: ExclamationTriangleIcon, color: "text-amber-400", border: "border-amber-500/30" },
  info: { icon: InformationCircleIcon, color: "text-blue-400", border: "border-blue-500/30" },
} as const;

/**
 * Toast mínimo, sin dependencias de animación. OlivoWeb usaba Headless UI y
 * lucide-react para esto; acá se reimplementó con Heroicons y CSS para no
 * arrastrar dos paquetes más a una app que se quiere liviana.
 */
export default function Toast({ type = "info", message, onClose, duration = 4000 }: ToastProps) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const config = CONFIG[type];
  const Icon = config.icon;

  return (
    <div
      role="status"
      className={`pointer-events-auto overflow-hidden rounded-2xl bg-slate-900/90 backdrop-blur-lg shadow-2xl ring-1 ring-white/10 border ${config.border}`}
    >
      <div className="px-4 py-2.5 flex items-center gap-2.5">
        <Icon className={`h-4 w-4 shrink-0 ${config.color}`} />
        <p className="text-[11px] font-black uppercase tracking-[0.08em] text-white">{message}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar aviso"
          className="ml-1 p-0.5 rounded-full text-white/30 hover:text-white transition-colors"
        >
          <XMarkIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
