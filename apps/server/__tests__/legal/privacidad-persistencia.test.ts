import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { schema } from "../../src/db/schema";
import { PRIVACY_HTML } from "../../src/legal/documents";

/**
 * Guardia legal↔persistencia — el mecanismo de `politica_privacidad_test.dart`
 * de biyu, traducido a la arquitectura client-server de Socrates.
 *
 * En biyu la cadena era esquema → export → política (la app sube tablas al
 * respaldo). En Socrates el análogo de "lo que sale del teléfono" es **lo que
 * el server persiste de cada estudiante**: `apps/server/src/db/schema.ts`.
 * La privacidad servida (`PRIVACY_HTML` en `src/legal/documents.ts`) declara
 * qué se guarda. NADA ataba esas dos cosas: agregar una columna con datos de
 * usuario pasaba en silencio total y la política envejecía mintiendo.
 *
 * Este test hace imposible agregar persistencia de usuario en silencio:
 *
 *   1. Toda tabla exportada por `schema.ts` tiene que estar en el manifiesto
 *      DECLARACION (aunque sea para decir "no guarda datos de usuario").
 *   2. TODA columna de TODA tabla tiene que estar clasificada: como dato de
 *      usuario (con su categoría) o como técnica. Una columna nueva que no
 *      matchee ningún patrón técnico rompe la suite hasta que alguien la
 *      clasifique — y clasificarla como dato de usuario obliga a que la
 *      categoría exista y su frase esté en PRIVACY_HTML.
 *   3. Nada declarado puede quedarse viejo: columnas del manifiesto que ya
 *      no existen también rompen.
 *   4. Cada categoría declarada tiene frases que PRIVACY_HTML tiene que
 *      contener — el eslabón schema → política.
 *
 * Nivel de comparación, a propósito: NO hay mapeo automático de "columna con
 * contenido de usuario" (frágil en ambas direcciones). Prefiero un manifiesto
 * ruidoso: cualquier columna nueva en cualquier tabla pide clasificación. Un
 * falso rojo se resuelve con una línea; un falso verde es una política que
 * miente ante Google Play y no hay quien lo note.
 *
 * Para romper este test a propósito y verlo fallar (regla del repo: un
 * guardia que nunca viste fallar no vale): agregá una tabla o columna a
 * `schema.ts` sin tocar este archivo, o borrale una frase a una categoría de
 * CATEGORIAS.
 */

/**
 * Categorías de datos de usuario — taxonomía CERRADA, alineada con las
 * secciones de la privacidad servida. Cada categoría exige frases que
 * PRIVACY_HTML tiene que contener: declarar una columna bajo una categoría
 * que la política no nombra rompe la suite. Agregar una categoría nueva
 * exige, además de este registro, que la política la declare.
 */
const CATEGORIAS = {
  cuenta: {
    que: "correo, nombre para mostrar, edad, país e idioma (privacidad §1.1)",
    frases: ["Correo electrónico", "Nombre para mostrar", "Confirmación de edad", "País e idioma"],
  },
  sesiones: {
    que: "estructura de estudio: nombres de cursos/materias y snapshots de sesión (fila de retención §5)",
    frases: ["Sesiones de estudio"],
  },
  mensajes: {
    que: "mensajes del estudiante y respuestas del tutor (privacidad §1.3)",
    frases: ["tus mensajes, las respuestas del tutor"],
  },
  material: {
    que: "texto extraído del material subido (privacidad §1.2) — el binario NUNCA se guarda",
    frases: ["El archivo original no se almacena", "texto extraído"],
  },
  evaluaciones: {
    que: "evaluaciones de comprensión y progreso derivado: mastery, logros, rachas, XP (privacidad §1.4)",
    frases: ["Evaluaciones de comprensión"],
  },
  temario: {
    que: "temario generado por IA: títulos de temas e hitos (mencionado en la tabla de proveedores §3)",
    frases: ["armar el temario de tu materia"],
  },
  uso: {
    que: "contadores y costo estimado de uso (privacidad §1.5)",
    frases: ["Uso y costo"],
  },
  consentimientos: {
    que: "registro de consentimiento permanente, seudonimizado al borrar la cuenta (privacidad §1.6)",
    frases: ["Registro de consentimiento", "código anónimo"],
  },
  seguridad: {
    que: "incidentes de seguridad: texto que disparó un bloqueo y notas de revisión (privacidad §2 «Prevenir abuso»)",
    frases: ["Prevenir abuso"],
  },
} as const;

type Categoria = keyof typeof CATEGORIAS;

/**
 * Patrones de nombres de columna que se aceptan como técnicos SIN declarar.
 * Deliberadamente conservadores: `*_at`, ids internos, versiones, hashes.
 * Si un patrón traga una columna con datos de usuario, el guardia queda
 * ciego — ante la duda, no ampliés el patrón: clasificá la columna.
 */
const PATRONES_TECNICOS: Array<{ patron: RegExp; porque: string }> = [
  { patron: /^id$/, porque: "clave primaria" },
  { patron: /Id$/, porque: "FK / identificador interno (uuid nuestro, no PII por sí mismo)" },
  { patron: /Ids$/, porque: "arreglo jsonb de ids internos" },
  { patron: /At$/, porque: "timestamp ISO-8601" },
  { patron: /^schemaVersion$/, porque: "versión de fila" },
  { patron: /^version$/, porque: "versión de definición (challenge_definitions)" },
  { patron: /Version$/, porque: "versión de prompt / pipeline / definición" },
  { patron: /Hash$/, porque: "hash de token — nunca el token crudo" },
];

type DeclaracionTabla = {
  /** columna → categoría de datos de usuario que la privacidad declara. */
  usuario?: Record<string, Categoria>;
  /** columnas técnicas que no matchean ningún PATRONES_TECNICOS. */
  tecnico?: string[];
  nota?: string;
};

/**
 * EL MANIFIESTO — qué columna de qué tabla guarda qué dato de usuario, y con
 * qué categoría de la privacidad se corresponde. `usuario` vacío/asente =
 * "esta tabla no persiste contenido de usuario" (igual hay que declararla).
 */
const DECLARACION: Record<string, DeclaracionTabla> = {
  users: {
    usuario: {
      displayName: "cuenta",
      authIdentifiers: "cuenta",
      primaryEmail: "cuenta",
      countryCode: "cuenta",
      preferredLanguageCode: "cuenta",
      ageConfirmedAt: "cuenta",
      birthYear: "cuenta",
    },
    tecnico: ["accountStatus", "accountKind"],
  },
  consents: {
    // El ledger de §1.6: identificador + qué aceptó + versión exacta + cuándo.
    // userId NO es un uuid técnico acá: es el identificador que se
    // seudonimiza (no se borra) al eliminar la cuenta.
    usuario: {
      userId: "consentimientos",
      type: "consentimientos",
      status: "consentimientos",
      policyVersion: "consentimientos",
      occurredAt: "consentimientos",
    },
  },
  courses: {
    usuario: { customLabel: "sesiones", academicYear: "sesiones" },
    tecnico: ["status"],
  },
  subjects: {
    usuario: { name: "sesiones" },
    // seedCatalogKey/seedLang son punteros a un catálogo público de libros
    // abiertos (packages/domain/data/seed/**), no un hecho sobre el
    // estudiante — "universidad/quimica" y "es"/"en" no identifican a nadie
    // ni cuentan nada de su actividad. Ninguna de las dos matchea un patrón
    // técnico automático (C1-b, docs/plan-onboarding-seed/01-plan-c0.md).
    tecnico: ["seedCatalogKey", "seedLang"],
  },
  materialAssets: {
    usuario: {
      originalFilename: "material",
      // { location: "device_only" | "cloud_blob", blobRef } — hoy blobRef es
      // null (el binario se descarta, §1.2). Si location llegara a ser
      // cloud_blob con binario real, la frase de esta categoría ("El archivo
      // original no se almacena") pasa a ser falsa: bump de política.
      storage: "material",
      digestedTextRef: "material",
    },
    tecnico: ["kind", "status", "tokenCount", "truncated", "droppedTokens", "processingReport"],
  },
  studySessions: {
    usuario: {
      subjectNameSnapshot: "sesiones",
      materialSnapshotTextRef: "material",
      materialSnapshotInfo: "material",
      // bandChanges lleva rationale (texto de IA sobre el estudiante) →
      // evaluaciones, no sesión.
      bandChanges: "evaluaciones",
    },
    tecnico: ["status", "kind", "initialBand", "materialAssetIds", "materialEvents"],
  },
  exchanges: {
    usuario: { studentMessage: "mensajes", tutorReply: "mensajes" },
    tecnico: ["index_", "timestamp", "band", "hintOffered", "studentCorrect"],
  },
  assessments: {
    usuario: {
      demonstratedUnderstanding: "evaluaciones",
      explainedInOwnWords: "evaluaciones",
      guessedOrPatternMatched: "evaluaciones",
      recommendedBand: "evaluaciones",
      rationale: "evaluaciones",
      topicKey: "evaluaciones",
    },
    tecnico: ["timestamp"],
  },
  masteryHistoryEntries: {
    usuario: { topicKey: "evaluaciones", level: "evaluaciones" },
  },
  masteryStates: {
    usuario: { topicKey: "evaluaciones", currentLevel: "evaluaciones" },
    tecnico: ["visibility"],
  },
  usageQuotas: {
    usuario: {
      tutorMessagesUsed: "uso",
      assessorCallsUsed: "uso",
      judgeCallsUsed: "uso",
      ingestCloudCallsUsed: "uso",
      costUsdEstimate: "uso",
      capTutorMessages: "uso",
      capCostUsd: "uso",
    },
    tecnico: ["period", "periodKey", "costUsdIncomplete"],
  },
  safetyIncidents: {
    // El texto bloqueado se guarda AUNQUE el Exchange nunca exista (Fase 3.1)
    // y se retiene hasta revisión humana. La privacidad lo cubre solo con el
    // propósito "Prevenir abuso" (§2) — ver DEVLOG 2026-09-03.
    usuario: { triggeringText: "seguridad", reviewNotes: "seguridad" },
    tecnico: ["category", "reviewedBy"],
  },
  quotaRejections: {
    usuario: { reason: "uso", surface: "uso" },
  },
  magicLinkTokens: {
    usuario: {
      // email y payload (campos de signup) existen ANTES de que exista la
      // cuenta; el hash del token es técnico (patrón Hash$).
      email: "cuenta",
      payload: "cuenta",
    },
    tecnico: ["purpose"],
  },
  streaks: {
    usuario: { current: "evaluaciones", longest: "evaluaciones" },
    tecnico: ["kind"],
  },
  challengeDefinitions: {
    // Catálogo de producto, no datos de usuario.
    nota: "catálogo de retos — sin datos de usuario",
    tecnico: ["scope", "titleKey", "descriptionKey", "criteria", "active"],
  },
  achievements: {
    usuario: { topicKey: "evaluaciones" },
    tecnico: ["status", "revokedReason", "retryOf"],
  },
  temarios: {
    nota: "la fila del temario no tiene contenido; los títulos viven en temas/hitos",
    tecnico: ["generatedBy"],
  },
  temas: {
    usuario: { title: "temario", stars: "evaluaciones", unitLabel: "temario" },
    tecnico: ["order", "status", "recommended"],
  },
  hitos: {
    usuario: { title: "temario" },
    tecnico: ["order", "kind", "coversUpToOrder", "status"],
  },
  fuentes: {
    usuario: { name: "material", text: "material" },
    tecnico: ["kind", "tokens"],
  },
  topicItems: {
    // Lote cacheado de ítems guiados (preguntas/exposiciones) por tema — contenido
    // pedagógico generado, análogo a temario §3 proveedores.
    usuario: { payload: "temario" },
  },
  sessionOpenings: {
    // Apertura del tutor (texto de IA). No hay studentMessage: esa es la razón
    // de la tabla, no fabricar un Exchange. Categoría mensajes = mismo tratamiento
    // que exchanges.tutorReply. status/claimedAt son el claim in-flight.
    usuario: { text: "mensajes" },
    tecnico: ["grounding", "status"],
  },
  xpEvents: {
    nota: "delta numérico con ids de referencia; el motivo es una clave interna, no texto",
    tecnico: [
      "delta",
      "reason",
      "assessmentRef",
      "itemId",
      "itemType",
      "difficulty",
      "correct",
      "responseMs",
      "attempt",
    ],
  },
  turnClaims: {
    // El claim se toma ANTES de la llamada al tutor: acá NO vive el texto del
    // mensaje (ese va a exchanges al persistir). ids + timestamp nomás.
    nota: "claim de idempotencia — ids y timestamps, sin texto del mensaje",
  },
  fuentesContextMetrics: {
    nota: "métricas de truncamiento: ids y números, nunca texto material (docblock de schema.ts)",
    tecnico: ["kind", "builder", "fuenteCount", "corpusTokens", "truncated", "droppedTokens"],
  },
  fuenteChunks: {
    usuario: {
      fuenteName: "material",
      text: "material",
      // embedding = derivado vectorial del texto extraído (pgvector). La
      // privacidad dice "guardamos únicamente el texto extraído"; un embedding
      // es una representación derivada de ese mismo texto — ver DEVLOG
      // 2026-09-03. Hoy nadie lo lee (plan-modal-rag F3 congelada).
      embedding: "material",
    },
    tecnico: ["chunkIndex"],
  },
};

const ayuda =
  "Clasificá la novedad en DECLARACION de apps/server/__tests__/legal/privacidad-persistencia.test.ts: " +
  "si guarda datos de usuario, declarala con su categoría (y si la política no lo declara, actualizá " +
  "PRIVACY_HTML en apps/server/src/legal/documents.ts — con bump de versión si es sustantivo); " +
  "si es técnica, declarala en tecnico (o ampliá un patrón SOLO si es inequívocamente técnico). " +
  "Una política que envejece en silencio es lo normal; por eso no se deja en silencio.";

describe("lo que el server persiste ↔ lo que la privacidad declara", () => {
  it("toda tabla del schema está declarada en el manifiesto", () => {
    const delSchema = Object.keys(schema).sort();
    const delManifiesto = Object.keys(DECLARACION).sort();
    const problemas: string[] = [];
    for (const t of delSchema.filter((t) => !(t in DECLARACION))) {
      problemas.push(
        `La tabla '${t}' existe en schema.ts y no está declarada en el manifiesto. ${ayuda}`,
      );
    }
    for (const t of delManifiesto.filter((t) => !(t in schema))) {
      problemas.push(
        `El manifiesto declara la tabla '${t}' pero ya no existe en schema.ts — actualizá el manifiesto.`,
      );
    }
    expect(problemas.join("\n\n")).toBe("");
  });

  it("toda columna de toda tabla está clasificada (usuario o técnica)", () => {
    const problemas: string[] = [];
    for (const [tabla, decl] of Object.entries(DECLARACION)) {
      const pgTable = (schema as Record<string, unknown>)[tabla];
      // Tabla del manifiesto que ya no existe: la reporta el test anterior.
      if (!pgTable) continue;
      const reales = Object.keys(getTableColumns(pgTable as Parameters<typeof getTableColumns>[0]));
      const usuario = Object.keys(decl.usuario ?? {});
      const tecnico = decl.tecnico ?? [];
      const sinClasificar = reales.filter(
        (c) =>
          !usuario.includes(c) &&
          !tecnico.includes(c) &&
          !PATRONES_TECNICOS.some((p) => p.patron.test(c)),
      );
      for (const c of sinClasificar) {
        problemas.push(
          `La columna '${tabla}.${c}' no está clasificada. ${ayuda}`,
        );
      }
      // Y al revés: nada declarado puede quedarse viejo.
      for (const c of usuario.filter((c) => !reales.includes(c))) {
        problemas.push(
          `El manifiesto declara '${tabla}.${c}' como dato de usuario pero esa columna ya no existe en schema.ts — actualizá el manifiesto (y la política, si la sacaron).`,
        );
      }
      for (const c of tecnico.filter((c) => !reales.includes(c))) {
        problemas.push(
          `El manifiesto declara '${tabla}.${c}' como técnica pero esa columna ya no existe en schema.ts — actualizá el manifiesto.`,
        );
      }
    }
    expect(problemas.join("\n\n")).toBe("");
  });

  it("toda categoría usada existe y su frase está declarada en la privacidad servida", () => {
    const problemas: string[] = [];
    const usadas = new Set<string>();
    for (const [tabla, decl] of Object.entries(DECLARACION)) {
      for (const [columna, cat] of Object.entries(decl.usuario ?? {})) {
        usadas.add(cat);
        if (!(cat in CATEGORIAS)) {
          problemas.push(
            `'${tabla}.${columna}' usa la categoría '${cat}' que no existe en CATEGORIAS — typo o categoría sin declarar. ${ayuda}`,
          );
        }
      }
    }
    for (const cat of usadas) {
      const def = (CATEGORIAS as Record<string, { que: string; frases: readonly string[] } | undefined>)[cat];
      if (!def) continue;
      for (const frase of def.frases) {
        if (!PRIVACY_HTML.includes(frase)) {
          problemas.push(
            `La privacidad servida (PRIVACY_HTML en documents.ts) no contiene «${frase}», que es lo que declara la categoría '${cat}' (${def.que}). ` +
              "Si agregaste persistencia de esa categoría, la política tiene que declararla; si la sacaste, sacá también las columnas del manifiesto.",
          );
        }
      }
    }
    expect(problemas.join("\n\n")).toBe("");
  });
});