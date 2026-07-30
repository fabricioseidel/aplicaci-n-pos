import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  compress: true,
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 7,
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // La cámara es la que usa el escáner de códigos de barras.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

/**
 * Service worker vía @serwist/next.
 *
 * Se eligió Serwist y no `next-pwa` (sin publicar desde 2022) ni
 * `@ducanh2912/next-pwa` (último release 2024): Serwist es el sucesor
 * mantenido del mismo autor y el único de los tres con releases recientes
 * y soporte declarado para el App Router de Next 15.
 *
 * En desarrollo va deshabilitado: un SW cacheando el shell durante `next dev`
 * sirve HTML viejo y hace perder horas depurando cambios que sí se guardaron.
 */
const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: true,
});

export default withSerwist(nextConfig);
