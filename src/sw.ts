import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, NetworkFirst, NetworkOnly } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    /**
     * Catálogo y sucursales: NetworkFirst.
     *
     * Se prefiere NetworkFirst sobre StaleWhileRevalidate porque en el
     * mostrador un precio o un stock desactualizado se cobra mal de verdad:
     * mientras haya red queremos el dato fresco, y sólo si la red falla (o
     * tarda más de 5 s, típico del wifi del local cuando se cae) servimos la
     * última copia buena para que el POS siga usable sin conexión.
     */
    {
      matcher: ({ url, request }) =>
        request.method === "GET" &&
        (url.pathname === "/api/products" || url.pathname === "/api/branches"),
      handler: new NetworkFirst({
        cacheName: "olivo-api-catalogo",
        networkTimeoutSeconds: 5,
        plugins: [],
      }),
    },
    /**
     * Todo lo demás bajo /api (ventas, caja, recepción, inventario) NUNCA se
     * cachea: son escrituras y estado de dinero. Cuando no hay red, el fetch
     * falla a propósito y el helper `apiWrite` encola la operación en el
     * outbox de IndexedDB. Servir una respuesta cacheada acá haría creer al
     * cajero que una venta se registró cuando no.
     */
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
