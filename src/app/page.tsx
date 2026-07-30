import OperacionesApp from "@/components/operaciones/OperacionesApp";

/**
 * Toda la app ES la herramienta de operaciones: sin panel admin alrededor,
 * sin tienda, sin navegación a otras secciones. Sólo la barra de pestañas.
 */
export default function Home() {
  return <OperacionesApp />;
}
