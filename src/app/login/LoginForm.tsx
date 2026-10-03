"use client";

import React, { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { ArrowPathIcon, LockClosedIcon } from "@heroicons/react/24/outline";

export default function LoginForm() {
  const params = useSearchParams();
  // Sólo rutas de este mismo sitio: un `callbackUrl` armado a mano no puede
  // mandar a la vendedora a otra página después de escribir su clave.
  const pedido = params.get("callbackUrl") || "/";
  const callbackUrl = pedido.startsWith("/") && !pedido.startsWith("//") ? pedido : "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "SinPermiso"
      ? "Tu cuenta no tiene permiso para usar el POS."
      : null
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl,
      });

      if (!res || res.error) {
        setError("Email o contraseña incorrectos.");
        setLoading(false);
        return;
      }

      // Navegación COMPLETA, no `router.replace`: los providers del layout
      // raíz (sucursales, sincronización) se montaron en /login sin sesión
      // y con la navegación del router no se vuelven a montar. Así quedaba
      // la sucursal en null y la caja se abría sin sucursal (#3). Recargar
      // la página los monta de nuevo, ya con la sesión.
      window.location.replace(callbackUrl);
      // `loading` sigue en true a propósito: la página se va a recargar.
      return;
    } catch {
      setError("No se pudo conectar. Revisa la conexión e intenta de nuevo.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-5">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-4">
            <LockClosedIcon className="w-7 h-7 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-black uppercase tracking-widest">Olivo POS</h1>
          <p className="text-white/40 text-xs mt-1">Ingresa con tu cuenta de la tienda</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              htmlFor="email"
              className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black border border-white/10 rounded-xl px-3 py-3 text-white text-base outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1"
            >
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black border border-white/10 rounded-xl px-3 py-3 text-white text-base outline-none focus:border-emerald-500"
            />
          </div>

          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs font-bold text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-13 min-h-[3.25rem] rounded-2xl bg-emerald-500 text-black text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40 active:bg-emerald-600 transition-colors"
          >
            {loading && <ArrowPathIcon className="h-5 w-5 animate-spin" />}
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
