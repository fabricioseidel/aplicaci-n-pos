import { Suspense } from "react";
import LoginForm from "./LoginForm";

export const metadata = {
  title: "Entrar · Olivo POS",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white/30 text-xs font-black uppercase tracking-widest">
          Cargando…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
