import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTACT_EMAIL,
  DELETE_ACCOUNT_HTML,
  DELETE_ACCOUNT_VERSION,
  PRIVACY_HTML,
  TERMS_HTML,
} from "../../src/legal/documents";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@buxo/domain/policy-versions";

/**
 * Guardia documents.ts ↔ espejo editorial ↔ versiones — el segundo eslabón
 * de la cadena legal (el mecanismo de biyu, adaptado).
 *
 * `apps/server/src/legal/documents.ts` es la fuente VIVA (la que sirve el
 * server y la que toca el estudiante). `docs/legal/*-socrates.md` es la
 * copia EDITORIAL de la que publica cubo.lat (se sincroniza a mano con
 * `~/git-projects/cubo-web/scripts/sincronizar-legales.sh`). Antes de este
 * test, editar una sin la otra pasaba en silencio: la suite en verde, la
 * página publicada mintiendo.
 *
 * Nivel de comparación, elegido a propósito: ESTRUCTURA, no bytes.
 *   - secuencia de encabezados `##` y `###` idéntica (secciones que
 *     desaparecen o se reordenan = rojo);
 *   - mismo id de versión en el HTML servido, en el md y en
 *     `packages/domain/policy-versions.ts` (que es lo que guarda la fila de
 *     `consents`);
 *   - mismo contacto (hola@cubo.lat);
 *   - un puñado de FRASES CLAVE por documento (las afirmaciones
 *     load-bearing) presentes en AMBOS lados.
 * NO se compara texto byte a byte porque el md es editorial: énfasis
 * (`**`), links `[x](y)`, saltos de línea distintos y la fecha de última
 * actualización (que el HTML tiene en el `.meta` y el md no lleva). Un test
 * que da falso rojo en cada coma es peor que ninguno: este solo rojea
 * cuando las dos fuentes dicen cosas DISTINTAS.
 *
 * La página PUBLICADA (https://cubo.lat/socrates/*) queda afuera de la suite
 * (saldría a la red); para eso existe `docs/legal/verificar-publicada.sh`,
 * que se corre A MANO antes de subir un bundle a Play.
 */

function raizDelRepo(): string {
  // El test vive en apps/server/__tests__/legal/; el md en docs/legal/ de la
  // raíz. Se busca subiendo para no depender del cwd desde donde se invoque
  // vitest (mismo criterio que el test de biyu).
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "docs", "legal", "terminos-socrates.md"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("No se encontró docs/legal/ desde el test — ¿movieron el espejo editorial?");
}

const RAIZ = raizDelRepo();
const leerMd = (nombre: string): string => readFileSync(path.join(RAIZ, "docs", "legal", nombre), "utf8");

/** Encabezados <h2>/<h3> del HTML servido, en orden. */
function encabezados(html: string, nivel: 2 | 3): string[] {
  const re = nivel === 2 ? /<h2>(.*?)<\/h2>/gs : /<h3>(.*?)<\/h3>/gs;
  return [...html.matchAll(re)].map((m) => m[1].trim());
}

/** Encabezados `## `/`### ` del md, en orden. */
function encabezadosMd(md: string, nivel: 2 | 3): string[] {
  const prefijo = nivel === 2 ? "## " : "### ";
  return md
    .split("\n")
    .filter((l) => l.startsWith(prefijo))
    .map((l) => l.slice(prefijo.length).trim());
}

/** Id de versión declarado en el `.meta` («Versión <code>…</code>»). */
function versionDe(texto: string): string | undefined {
  return texto.match(/Versión\s*<code>([^<]+)<\/code>/)?.[1]?.trim();
}

/**
 * Texto comparable: sin comentarios, sin énfasis markdown, sin links (queda
 * el texto ancla), sin tags, con espacios colapsados. Aplica a md y HTML por
 * igual — el md lleva bloques HTML crudos (`<p class="meta">`).
 */
function textoComparable(origen: string): string {
  return origen
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

type Documento = {
  nombre: string;
  html: string;
  md: string;
  version: string;
  frases: string[];
};

const DOCUMENTOS: Documento[] = [
  {
    nombre: "terminos",
    html: TERMS_HTML,
    md: leerMd("terminos-socrates.md"),
    version: CURRENT_TERMS_VERSION,
    frases: [
      "no te da la respuesta",
      "13 años o más",
      "No usamos contraseñas",
      "Eliminar mi cuenta",
      "seudonimizada",
      "República de El Salvador",
    ],
  },
  {
    nombre: "privacidad",
    html: PRIVACY_HTML,
    md: leerMd("privacidad-socrates.md"),
    version: CURRENT_PRIVACY_VERSION,
    frases: [
      "Correo electrónico",
      "Nombre para mostrar",
      "El archivo original no se almacena",
      "tus mensajes, las respuestas del tutor",
      "Evaluaciones de comprensión",
      "código anónimo",
      "Prevenir abuso",
      "gemma (Google)",
      "DeepSeek (DeepSeek)",
      "Qwen (Alibaba)",
      "No vendemos tu información",
      "13 años o más",
    ],
  },
  {
    nombre: "eliminar-cuenta",
    html: DELETE_ACCOUNT_HTML,
    md: leerMd("eliminar-cuenta-socrates.md"),
    version: DELETE_ACCOUNT_VERSION,
    frases: [
      "sin reinstalar la app",
      "seudonimiza",
      "Tu progreso de estudio",
      "Tus fuentes de estudio",
      "código anónimo",
    ],
  },
];

describe("documents.ts ↔ espejo editorial de docs/legal ↔ versiones", () => {
  const ayuda =
    "documents.ts es la fuente VIVA y el md de docs/legal/ es el espejo editorial " +
    "(el que publica cubo.lat con scripts/sincronizar-legales.sh). Si cambiaste uno, " +
    "cambiá el otro — y si el cambio es sustantivo, subí la versión en " +
    "packages/domain/policy-versions.ts y archivá el texto anterior.";

  for (const doc of DOCUMENTOS) {
    describe(doc.nombre, () => {
      it("tiene las mismas secciones (## y ###) en el HTML servido y en el espejo", () => {
        const problemas: string[] = [];
        const h2Html = encabezados(doc.html, 2);
        const h2Md = encabezadosMd(doc.md, 2);
        if (JSON.stringify(h2Md) !== JSON.stringify(h2Html)) {
          problemas.push(
            `Secciones ## distintas.\n  HTML servido: ${JSON.stringify(h2Html)}\n  Espejo md:   ${JSON.stringify(h2Md)}\n${ayuda}`,
          );
        }
        const h3Html = encabezados(doc.html, 3);
        const h3Md = encabezadosMd(doc.md, 3);
        if (JSON.stringify(h3Md) !== JSON.stringify(h3Html)) {
          problemas.push(
            `Subsecciones ### distintas.\n  HTML servido: ${JSON.stringify(h3Html)}\n  Espejo md:   ${JSON.stringify(h3Md)}\n${ayuda}`,
          );
        }
        expect(problemas.join("\n\n")).toBe("");
      });

      it("declara el mismo id de versión en HTML, espejo y policy-versions", () => {
        const vHtml = versionDe(doc.html);
        const vMd = versionDe(doc.md);
        expect(
          `HTML servido: ${vHtml ?? "(sin «Versión <code>…» en el .meta)"} / ` +
            `espejo md: ${vMd ?? "(sin «Versión <code>…» en el .meta)"} / esperada: ${doc.version}`,
        ).toBe(`HTML servido: ${doc.version} / espejo md: ${doc.version} / esperada: ${doc.version}`);
      });

      it("menciona el mismo contacto", () => {
        expect(
          `HTML incluye ${CONTACT_EMAIL}: ${doc.html.includes(CONTACT_EMAIL)} / ` +
            `espejo lo incluye: ${doc.md.includes(CONTACT_EMAIL)}`,
        ).toBe(`HTML incluye ${CONTACT_EMAIL}: true / espejo lo incluye: true`);
      });

      it("dice lo mismo en las frases clave (afirmaciones load-bearing)", () => {
        const problemas: string[] = [];
        const htmlComparable = textoComparable(doc.html);
        const mdComparable = textoComparable(doc.md);
        for (const frase of doc.frases) {
          const enHtml = htmlComparable.includes(textoComparable(frase));
          const enMd = mdComparable.includes(textoComparable(frase));
          if (!enHtml || !enMd) {
            problemas.push(
              `«${frase}» ${enHtml ? "" : "FALTA en el HTML servido"}${!enHtml && !enMd ? " y" : ""}${enMd ? "" : " FALTA en el espejo md"}. ${ayuda}`,
            );
          }
        }
        expect(problemas.join("\n\n")).toBe("");
      });
    });
  }
});