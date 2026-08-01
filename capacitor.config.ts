import type { CapacitorConfig } from "@capacitor/cli";

// App nativa "cascarón" del POS: no lleva build web propio, sirve el sitio en
// vivo desde `server.url`. Así cada deploy en Vercel actualiza la app de los
// celulares del mostrador sin reinstalar el APK.
const config: CapacitorConfig = {
  appId: "cl.olivomarket.pos",
  appName: "Olivo POS",
  webDir: "www",
  server: {
    url: "https://aplicaci-n-pos.vercel.app",
    androidScheme: "https",
    allowNavigation: ["aplicaci-n-pos.vercel.app"],
  },
};

export default config;
