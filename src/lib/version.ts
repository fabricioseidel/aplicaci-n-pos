/**
 * Versión de esta compilación. `next.config.ts` la fija al compilar (el commit
 * en Vercel); la usan tanto el servidor como el teléfono, así que comparar las
 * dos dice si el teléfono quedó con una versión vieja.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
