/**
 * Bytes ESC/POS para la térmica de 58 mm (MPT-II): 32 columnas en fuente A,
 * que es justo el ancho con que `buildCierreLines` arma el ticket.
 *
 * Se usa la tabla de caracteres PC437 porque es la que traen de fábrica casi
 * todas las térmicas genéricas, y igual se fija al inicio por si alguien la
 * cambió. Tiene ñ, Ñ, ¿, ¡ y las vocales con tilde en minúscula; las
 * mayúsculas con tilde (salvo É) no existen ahí y salen sin tilde.
 */

const ESC = 0x1b;
const LF = 0x0a;

/** Líneas en blanco al final para que el ticket salga entero de la tapa. */
const AVANCE_FINAL = 4;

const PC437: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ü: 0x81,
  ñ: 0xa4, Ñ: 0xa5, É: 0x90, Ü: 0x9a,
  "¿": 0xa8, "¡": 0xad, "°": 0xf8, "·": 0xfa,
};

function codificar(texto: string): number[] {
  const out: number[] = [];
  for (const ch of texto) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) {
      out.push(code);
    } else if (PC437[ch] !== undefined) {
      out.push(PC437[ch]);
    } else if (ch === " " || ch === " " || ch === "\t") {
      // Los espacios que mete toLocaleString en algunos formatos.
      out.push(0x20);
    } else {
      // Á → A, etc. Lo que no tenga equivalente se marca en vez de perderse.
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const b = base.codePointAt(0) ?? 0;
      out.push(base.length === 1 && b >= 0x20 && b < 0x7f ? b : 0x3f);
    }
  }
  return out;
}

export function ticketEscPos(lineas: string[]): Uint8Array {
  const bytes: number[] = [
    ESC, 0x40, // ESC @: reinicia la impresora (borra estilos de un ticket anterior)
    ESC, 0x74, 0x00, // ESC t 0: tabla PC437
  ];
  for (const linea of lineas) bytes.push(...codificar(linea), LF);
  bytes.push(ESC, 0x64, AVANCE_FINAL); // ESC d n: avanza n líneas
  return Uint8Array.from(bytes);
}

/** El plugin nativo recibe los bytes en base64 (el bridge sólo pasa texto). */
export function aBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
