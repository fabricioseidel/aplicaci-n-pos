import "next-auth";
import "next-auth/jwt";

/**
 * La sesión lleva `role` y `id` porque toda la autorización del POS
 * (middleware + requireApiAdminOrSeller) se decide con esos dos campos.
 */
declare module "next-auth" {
  interface Session {
    role?: string;
    user?: {
      id?: string;
      role?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User {
    id: string;
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: string;
  }
}
