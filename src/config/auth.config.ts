import { type NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getUserByEmail } from "@/services/auth-users";

/**
 * NextAuth del POS: sólo credenciales (email + password contra
 * `users.password_hash`). Se dejó fuera Google OAuth a propósito — esta app
 * la usan cajeros en el mostrador con una cuenta de la tienda, no hay razón
 * para exponer un segundo camino de login.
 */
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Credentials({
      name: "Email y contraseña",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password;
        if (!email || !password) return null;

        const user = await getUserByEmail(email);
        if (!user) return null;

        const hash = user.password_hash;
        if (!hash || typeof hash !== "string" || hash.length < 20) return null;

        const ok = await bcrypt.compare(password, hash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? "Usuario",
          role: user.role ?? "USER",
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.sub = String(user.id);
        token.role = user.role || "USER";
      }

      // El rol se re-lee de la base en cada refresh del token: si a alguien le
      // quitan el rol SELLER, la sesión que ya tenía abierta deja de servir.
      const email = token.email?.toLowerCase();
      if (email) {
        try {
          const existing = await getUserByEmail(email);
          if (existing) {
            // El id se re-sincroniza siempre, no sólo cuando falta. Un token
            // viejo puede traer un uid que ya no está en `users` (usuario
            // recreado con otro uuid), y ese uid fantasma rompe todo insert
            // con FK a users — abrir caja, entre otros — con la sesión
            // pareciendo válida.
            token.uid = existing.id;
            token.sub = existing.id;
            token.role = existing.role || "USER";
          }
        } catch {
          /* si la base no responde se conserva el rol del token */
        }
      }

      token.role = token.role || "USER";
      return token;
    },

    async session({ session, token }) {
      session.role = token.role || "USER";
      if (session.user) {
        session.user.id = token.uid;
        session.user.role = token.role || "USER";
      }
      return session;
    },
  },
};
