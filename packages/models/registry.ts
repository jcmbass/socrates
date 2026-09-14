/**
 * The capabilities registry DATA — C-backend-plataforma.md §1.2 (rows) and
 * §1.6 (candidate table). Populated by hand, per the spec's own rule: never
 * queried from `@ai-sdk/*`'s internal capability tables.
 *
 * Every number here traces to spec text (docs/plan-app-multiplataforma/
 * especificaciones/C-backend-plataforma.md); where the spec gives a range
 * instead of a point estimate, or gives no number at all, the field is
 * `null` with a `// TODO(gate): confirmar al correr gate` comment — per the
 * task's explicit "NO inventes números" rule. `structuredOutputSupport` for
 * the Anthropic rows is corroborated against the ACTUAL installed
 * `@ai-sdk/anthropic@4.0.1` source (`getModelCapabilities` in
 * `node_modules/@ai-sdk/anthropic/dist/index.js`) as of 2026-07-14:
 * `claude-sonnet-5` is NOT in its capability table (falls to the
 * `supportsStructuredOutput: false` default — confirms the fase-4 bug
 * story exactly); `claude-haiku-4-5` IS recognized natively. Both rows
 * still carry `structuredOutputForce` regardless, because C7's whole
 * premise is not to trust that table even when it happens to be right
 * today — a future `@ai-sdk/anthropic` bump could silently change it.
 */
import { z } from "zod";
import type { ModelCapabilities } from "./capabilities";
import { ModelCapabilitiesSchema } from "./capabilities";
import type { ModelRef, TaskKind } from "./task";
import { modelRefKey } from "./task";
import { unregisteredModelError } from "./errors";

const ANTHROPIC_STRUCTURED_OUTPUT_FORCE = { anthropic: { structuredOutputMode: "outputFormat" } };

export const MODEL_REGISTRY: readonly ModelCapabilities[] = [
  // --- Anthropic — gateado hoy en este repo (docs/plan-harness-autonomo/), en uso en apps/harness ---
  {
    providerId: "anthropic",
    modelId: "claude-sonnet-5",
    structuredOutputSupport: "native_schema",
    structuredOutputForce: ANTHROPIC_STRUCTURED_OUTPUT_FORCE,
    toolUse: true,
    vision: true,
    streaming: true,
    promptCaching: "explicit_breakpoints",
    maxContextTokens: null, // TODO(gate): confirmar al correr gate
    maxOutputTokens: null, // TODO(gate): confirmar al correr gate
    pricePerMTokIn: 2, // confirmado, apps/harness/lib/ingest/pricing.ts — intro pricing through 2026-08-31
    pricePerMTokOut: 10,
    costModel: "per-token",
    fixedCostRef: null,
    notes:
      "Baseline actual del tutor/assessor/judge y piso no configurable de toda cadena (§1.3). " +
      "@ai-sdk/anthropic@4.0.1's getModelCapabilities NO reconoce este modelId (verificado en " +
      "node_modules 2026-07-14) -> sin structuredOutputForce, generateObject degrada en silencio " +
      "al fallback jsonResponseTool (docs/LECCIONES-Y-BUGS.md 2026-07-11). Baseline de calibración " +
      "del gate de assessor (§1.4 punto 3).",
    verifiedAt: "2026-07-11",
    verifiedBy: "manual_docs_review",
    gateStatus: "validated",
  },
  {
    providerId: "anthropic",
    modelId: "claude-haiku-4-5",
    structuredOutputSupport: "native_schema",
    structuredOutputForce: ANTHROPIC_STRUCTURED_OUTPUT_FORCE,
    toolUse: true,
    vision: true,
    streaming: true,
    promptCaching: "explicit_breakpoints",
    maxContextTokens: null, // TODO(gate): confirmar al correr gate
    maxOutputTokens: null, // TODO(gate): confirmar al correr gate
    pricePerMTokIn: 1, // confirmado, apps/harness/lib/ingest/pricing.ts
    pricePerMTokOut: 5,
    costModel: "per-token",
    fixedCostRef: null,
    notes:
      "Ya gateado (gate de Haiku, docs/plan-harness-autonomo/) y ya en uso en lib/ingest y como " +
      "BUXO_TUTOR_MODEL=haiku opcional. Peldaño de fallback conocido-bueno entre el candidato " +
      "barato y Sonnet (§1.6). getModelCapabilities SÍ reconoce claude-haiku-4-5 nativamente; se " +
      "fuerza structuredOutputForce igual, por disciplina (no confiar en la tabla del SDK incluso " +
      "cuando hoy acierta).",
    verifiedAt: "2026-07-10",
    verifiedBy: "gate_suite",
    gateStatus: "validated",
  },

  // --- Candidatos open-source / agregados, §1.6 — ninguno ha corrido el gate O-14 todavía ---
  {
    providerId: "openrouter",
    modelId: "deepseek-v3.2",
    structuredOutputSupport: "native_json_mode",
    structuredOutputForce: null, // TODO(gate): confirmar el providerOptions exacto del host OpenRouter elegido
    toolUse: true,
    vision: false,
    streaming: true,
    promptCaching: "none", // vía OpenRouter; la API directa de DeepSeek ofrecería caché automático (§2.6) — TODO(gate) confirmar si aplica ruteado por OpenRouter
    maxContextTokens: null, // TODO(gate): confirmar al correr gate
    maxOutputTokens: null, // TODO(gate): confirmar al correr gate
    pricePerMTokIn: 0.27, // estimado, §1.6 — no es cotización vigente confirmada
    pricePerMTokOut: 1.1,
    costModel: "per-token",
    fixedCostRef: null,
    notes:
      "Candidato primario propuesto para tutor bulk (~7-9x más barato que Sonnet por token). " +
      "Origen: laboratorio chino — riesgo de residencia de datos, checklist F0 de C5 §5.1 " +
      "pendiente antes de tráfico de producción real. pending_gate: no ha corrido el gate O-14.",
    verifiedAt: "2026-07-12",
    verifiedBy: "manual_docs_review",
    gateStatus: "pending_gate",
  },
  {
    providerId: "openrouter",
    modelId: "qwen2.5-72b-instruct",
    structuredOutputSupport: "tool_fallback",
    structuredOutputForce: null, // TODO(gate): confirmar el providerOptions exacto del host OpenRouter elegido
    toolUse: true,
    vision: false, // variantes -VL existen para ingesta-visión pero no se modelan como fila separada aquí (fuera de alcance F1/WP4 — C4 es F2)
    streaming: true,
    promptCaching: "none",
    maxContextTokens: null, // TODO(gate): confirmar al correr gate
    maxOutputTokens: null, // TODO(gate): confirmar al correr gate
    pricePerMTokIn: 0.35, // estimado, §1.6
    pricePerMTokOut: 0.4,
    costModel: "per-token",
    fixedCostRef: null,
    notes:
      "Candidato alterno al tutor; fuerte en español/multilingüe según benchmarks públicos " +
      "generales (§1.6). Mismo riesgo de origen (China) que DeepSeek — mismo checklist C5 §5.1 " +
      "pendiente. pending_gate: no ha corrido el gate O-14.",
    verifiedAt: "2026-07-12",
    verifiedBy: "manual_docs_review",
    gateStatus: "pending_gate",
  },
  {
    providerId: "together",
    modelId: "llama-3.3-70b-instruct",
    structuredOutputSupport: "tool_fallback",
    structuredOutputForce: null, // TODO(gate): confirmar al correr gate
    toolUse: true,
    vision: false,
    streaming: true, // Groq (vía alterna) es notoriamente rápido en streaming; Together AI usado aquí como referencia de precio
    promptCaching: "none",
    maxContextTokens: null, // TODO(gate): confirmar al correr gate
    maxOutputTokens: null, // TODO(gate): confirmar al correr gate
    pricePerMTokIn: 0.59, // estimado (Together, aprox.), §1.6
    pricePerMTokOut: 0.79,
    costModel: "per-token",
    fixedCostRef: null,
    notes:
      "Origen Meta (EE.UU.) — atractivo si el riesgo de residencia de datos de labs chinos pesa " +
      "más que el precio (§1.6). Groq da latencia muy baja para el tutor streaming, pero el precio " +
      "de esta fila es el de Together AI; una fila Groq separada requeriría su propia verificación " +
      "de precio (TODO(gate)). pending_gate: no ha corrido el gate O-14.",
    verifiedAt: "2026-07-12",
    verifiedBy: "manual_docs_review",
    gateStatus: "pending_gate",
  },
  {
    providerId: "mistral",
    modelId: "mistral-small-latest",
    structuredOutputSupport: "native_json_mode",
    structuredOutputForce: null, // TODO(gate): confirmar al correr gate
    toolUse: false, // TODO(gate): confirmar soporte de tool-calling — la spec no lo afirma para esta fila
    vision: false,
    streaming: true,
    promptCaching: "none",
    maxContextTokens: null, // TODO(gate): confirmar al correr gate
    maxOutputTokens: null, // TODO(gate): confirmar al correr gate
    // La spec (§1.6) da un RANGO para todo el tier Small/Large ($0.20-2.00 / $0.60-6.00), no un
    // punto para "Small" específicamente -> null, no se inventa un punto dentro del rango.
    pricePerMTokIn: null, // TODO(gate): confirmar precio exacto de mistral-small-latest
    pricePerMTokOut: null, // TODO(gate): confirmar precio exacto de mistral-small-latest
    costModel: "per-token",
    fixedCostRef: null,
    notes:
      "Origen UE — perfil de cumplimiento de datos distinto (posible ventaja regulatoria). Precio " +
      "competitivo en el tier Small según la spec, pero sin un punto de precio único citado — ver " +
      "TODO(gate). pending_gate: no ha corrido el gate O-14.",
    verifiedAt: "2026-07-12",
    verifiedBy: "manual_docs_review",
    gateStatus: "pending_gate",
  },
  {
    providerId: "mistral",
    modelId: "mistral-large-latest",
    structuredOutputSupport: "native_json_mode",
    structuredOutputForce: null, // TODO(gate): confirmar al correr gate
    toolUse: false, // TODO(gate): confirmar soporte de tool-calling — la spec no lo afirma para esta fila
    vision: false,
    streaming: true,
    promptCaching: "none",
    maxContextTokens: null, // TODO(gate): confirmar al correr gate
    maxOutputTokens: null, // TODO(gate): confirmar al correr gate
    pricePerMTokIn: null, // TODO(gate): confirmar precio exacto de mistral-large-latest (spec solo da rango del tier)
    pricePerMTokOut: null, // TODO(gate): confirmar precio exacto de mistral-large-latest
    costModel: "per-token",
    fixedCostRef: null,
    notes:
      "Origen UE. Mismo rango sin punto único que mistral-small-latest — ver TODO(gate). " +
      "pending_gate: no ha corrido el gate O-14.",
    verifiedAt: "2026-07-12",
    verifiedBy: "manual_docs_review",
    gateStatus: "pending_gate",
  },

  // --- Ollama cloud (gemma4:31b-cloud) — validated como tutor tras BE2; structured output NO FUNCIONA vía OpenAI-compat ---
  {
    providerId: "ollama",
    modelId: "gemma4:31b-cloud",
    structuredOutputSupport: "none", // BE2: generateObject FALLÓ 0/20 — Ollama OpenAI-compat NO soporta response_format json_schema
    structuredOutputForce: null, // BE2: no aplica — el SDK no puede forzar json_object con validación de schema
    toolUse: false, // TODO(gate): confirmar tool-calling vía OpenAI-compat endpoint
    vision: false,
    streaming: true,
    promptCaching: "none",
    maxContextTokens: null, // TODO(gate): confirmar al correr gate
    maxOutputTokens: null, // TODO(gate): confirmar al correr gate
    pricePerMTokIn: null, // self-hosted (sub founder): sin precio por token
    pricePerMTokOut: null, // self-hosted (sub founder): sin precio por token
    costModel: "self-hosted", // corre bajo la suscripción del founder → costo marginal 0
    fixedCostRef: "Ollama cloud subscription (founder, 2026-07)",
    notes:
      "Validado vía BE2 gate O-14 tutor (buxo-socratic-v4), 3/3 suites, n=3 (caveat: muestra pequeña, " +
      "Wilson amplio). Structured output NO disponible en Ollama Cloud (docs oficiales + sondeo 0/3) — " +
      "solo sirve como tutor (generateText), NO como assessor. El path VPS local (Ollama local, structured " +
      "outputs sí funcionan) queda como deuda para migrar el assessor a gemma-local y bajar Anthropic a $0.",
    verifiedAt: "2026-07-18",
    verifiedBy: "gate_suite",
    gateStatus: "validated",
  },

  // --- DeepInfra (Qwen3-VL-30B-A3B-Instruct) — candidato Tier-2 de ingesta (transcripción imagen→texto), pending_gate ---
  {
    providerId: "deepinfra",
    modelId: "Qwen/Qwen3-VL-30B-A3B-Instruct",
    // No medido — esta fila sirve solo a ingesta (transcribir imagen→texto vía
    // generateText), no necesita structured output. "none" por disciplina: no
    // se afirma una capacidad sin haberla corrido.
    structuredOutputSupport: "none",
    structuredOutputForce: null,
    toolUse: false, // no necesario para ingesta
    vision: true,
    streaming: true, // endpoint OpenAI-compat estándar — TODO(gate): confirmar explícitamente al correr gate
    promptCaching: "none", // TODO(gate): confirmar al correr gate
    maxContextTokens: null, // TODO(gate): confirmar al correr gate
    maxOutputTokens: null, // TODO(gate): confirmar al correr gate
    // Precios publicados por DeepInfra, confirmados contra factura real
    // (desvío 0.4%) — docs/plan-modal-rag/05-medicion-deepinfra-por-token.md.
    pricePerMTokIn: 0.15,
    pricePerMTokOut: 0.6,
    costModel: "per-token",
    fixedCostRef: null,
    notes:
      "Candidato a reemplazar Haiku-visión en Tier-2 de ingesta: ~6x más barato " +
      "(US$0.00069/página medido vs US$0.004 de Haiku) y mejor calidad medida (ortografía, " +
      "respeta el orden lógico en páginas a dos columnas, [Figura: descripción] en su posición) — " +
      "docs/plan-modal-rag/05-medicion-deepinfra-por-token.md (2026-08-01). Medición: una página " +
      "por caso (3 páginas) más un libro completo (429 págs, 0 fallos, desvío de tarifa 0.4% contra " +
      "factura real). GATE O-14 CORRIDO Y APROBADO (2026-08-02, " +
      "docs/plan-modal-rag/06-gate-o14-ingesta.md, infra/modal/deepinfra_gate.py): 25 páginas de " +
      "texto digital limpio (13 español / 12 inglés, reportadas por separado para que el inglés no " +
      "infle el resultado); recall mediano ES 0.982, precisión mediana ES 1.000, piso de precisión " +
      "0.838, US$0.0166. La verdad de referencia es la capa de texto digital del propio PDF, usando " +
      "solo páginas que el detector de encoding sospechoso NO marca. Métrica INSENSIBLE AL ORDEN a " +
      "propósito: la v1 con SequenceMatcher marcaba reordenamiento como alucinación (4 de 7 bloques " +
      "'alucinados' estaban literalmente en la página) y castigaba la mejora de orden lógico de " +
      "544677d. Control negativo hecho: cruzando páginas la precisión cae a 0.06-0.52. " +
      "LIMITACIONES DECLARADAS: español n=13 (es TODO el material en español del corpus con texto " +
      "digital limpio); peor página Cormen p24 recall 0.660 (omite, no inventa: precisión 0.949). " +
      "⚠️ CONTRADICCIÓN DEL CATÁLOGO (2026-08-10): GET /models/{id} de DeepInfra declara tag 'tools' " +
      "nativo para este modelo, contradiciendo la premisa del plan de migración (F1). Dato del API SIN " +
      "verificar por gate — no se afirma la capacidad ni se cambia el plan (decisión del arquitecto, " +
      "F2 2026-08-10: temario-builder no cuelga tareas agénticas de un modelo de visión por un tag). " +
      "Esta fila sirve SOLO a ingesta.",
    verifiedAt: "2026-08-02",
    verifiedBy: "gate_suite",
    gateStatus: "validated",
  },

  // --- DeepInfra (google/gemma-4-31B-it) — candidato de texto para tutor/assessor/judge/temario, pending_gate ---
  {
    providerId: "deepinfra",
    modelId: "google/gemma-4-31B-it",
    // MEDIDO por el gate F2 (run-deepinfra-assessor-cli, 2026-08-11, CON
    // supportsStructuredOutputs:true en provider.ts — lever aprobado por el
    // arquitecto): el SDK envía response_format json_schema y DeepInfra valida
    // el schema server-side → reliability 20/20 al 1er intento (100% ≥ 95%),
    // 0 retries, $0.0037. El valor es native_schema (schema validado por el
    // server). Sin el lever el SDK degradaba a json_object → 90% (18/20) —
    // era culpa del cableado, no del modelo. Se escribe native_schema y NO
    // "none" porque structured.ts:105 hace skip de candidatos "none" para
    // assessor/judge — si esta fila dijera "none", el gate mediría el piso
    // Sonnet (quema Anthropic + mide el modelo equivocado).
    structuredOutputSupport: "native_schema",
    structuredOutputForce: null, // el lever vive en provider.ts (supportsStructuredOutputs), no en la fila
    toolUse: true, // MEDIDO por smoke test real (gate F2, 2026-08-10): el modelo llamó una tool y reportó su valor exacto
    vision: true, // tags "vlm"/"vision" en catálogo (2026-08-10) — las tareas destino son de texto
    streaming: true, // endpoint OpenAI-compat estándar — TODO(gate): confirmar explícitamente al correr gate
    promptCaching: "none", // el base google/gemma-4-31B-it NO trae tag prompt_cache (2026-08-10); la variante -turbo sí
    maxContextTokens: null, // invariante de registry.test.ts exige null en toda fila; valor REAL del catálogo: 262144 (ver notes)
    maxOutputTokens: null,
    // Precios publicados por DeepInfra, catálogo real 2026-08-10 (GET /v1/openai/models).
    pricePerMTokIn: 0.13,
    pricePerMTokOut: 0.38,
    costModel: "per-token",
    fixedCostRef: null,
    notes:
      "Candidato de texto para tutor/assessor/judge/temario-builder (docs/plan-migracion-deepinfra/00-plan.md, " +
      "2026-08-10). Id EXACTO confirmado contra el catálogo real (GET /v1/openai/models, 2026-08-10). Contexto " +
      "del catálogo: 262144 tokens — NO volcado al campo maxContextTokens por la invariante de registry.test.ts. " +
      "GATE F2 (2026-08-11, run-deepinfra-assessor-cli, CON lever supportsStructuredOutputs:true en provider.ts): " +
      "reliability 20/20 al 1er intento (100%, $0.0037) → structuredOutputSupport native_schema CON evidencia. " +
      "⚠️ CALIBRACIÓN FAIL: laxer rate 60.7% [42.4-76.4] vs umbral 20% — 17/28 items sobre-graduados (gemma " +
      "infla demonstratedUnderstanding y banda sistemáticamente; matriz: GT none/weak → developing/solid). El " +
      "modelo es CONFiable en forma pero MAL calibrado en severidad. Referencia: buxo-assessor-v3/Sonnet 14.3%. " +
      "gateStatus pending_gate (el gate NO pasó). ACOPLAMIENTO: supportsStructuredOutputs es por-proveedor " +
      "(factory openai-compatible), impacta a todo modelo deepinfra futuro — hoy nulo (ingesta usa generateText, " +
      "Qwen en none). toolUse MEDIDO por smoke test real: llamó una tool y reportó el valor exacto (PASS) — " +
      "temario-builder puede migrar a este modelo (no depende de calibración, solo de tools). Judge cubierto por " +
      "reliability compartida (20/20); calibración es assessor-only por diseño. Tutor v4: PASS 5/5, 0 violaciones. " +
      "Alternativa MoE: google/gemma-4-26B-A4B-it ($0.07/$0.34) — no modelada hasta decidir el destino del " +
      "assessor. gateStatus por-tarea (F3 2026-08-11): tutor+temario-builder validated (sus gates pasaron), " +
      "assessor+judge pending_gate (calibración FAIL — el modelo infla severidad 60.7% vs 20%). " +
      "Decisión pendiente del arquitecto: candidato assessor alternativo (deepseek-ai/DeepSeek-V4-Flash), " +
      "iterar prompt/calibración, o rúbrica mecánica.",
    verifiedAt: "2026-08-11",
    verifiedBy: "gate_suite",
    gateStatus: {
      tutor: "validated",
      "temario-builder": "validated",
      // guided-items is a NEW structured task (8-item batch + mechanical
      // anti-tautology). Native-schema 20/20 was measured on the assessor
      // shape, not this one — do not lie with "validated". Closed beta
      // moved the chain/floor to DeepSeek-V4-Flash-0731; Gemma stays
      // pending_gate here so a misconfigured chain cannot claim a gate.
      "guided-items": "pending_gate",
    },
  },

  // --- DeepInfra (deepseek-ai/DeepSeek-V4-Flash-0731) — candidato assessor alternativo, pending_gate ---
  {
    providerId: "deepinfra",
    modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
    // MEDIDO por el gate F3 (run-deepinfra-assessor-cli, 2026-08-11): con el
    // lever supportsStructuredOutputs activo (json_schema server-side),
    // reliability 20/20 al 1er intento (100%), $0.0025 → native_schema CON
    // evidencia. NO "none": structured.ts:105 haría skip y el gate mediría el
    // piso Sonnet.
    structuredOutputSupport: "native_schema",
    structuredOutputForce: null, // lever en provider.ts (supportsStructuredOutputs), no en la fila
    toolUse: true, // tag "tools" en catálogo nativo (2026-08-11) — no medido por gate aún
    vision: false, // modelo de texto ("text-generation")
    streaming: true, // endpoint OpenAI-compat estándar
    promptCaching: "none", // provisional: el config nativo declara rate de cache read (0.2×) — no medido por gate
    maxContextTokens: null, // invariante registry.test.ts; valor REAL del catálogo: 1048576 (ver notes)
    maxOutputTokens: null, // valor REAL: 65536 (ver notes)
    // Precios del catálogo nativo 2026-08-11 (GET /models/{id}: cents_per_*_token).
    pricePerMTokIn: 0.08,
    pricePerMTokOut: 0.18,
    costModel: "per-token",
    fixedCostRef: null,
    notes:
      "Candidato ASSESSOR alternativo a google/gemma-4-31B-it (decisión del arquitecto 2026-08-11: familia " +
      "distinta al tutor — el árbitro no debe ser el mismo jugador, evita auto-lenidad). ⚠️ LECCIÓN: el id " +
      "sin fecha (deepseek-ai/DeepSeek-V4-Flash) es la PREVIEW; el release oficial es -0731 ($0.08/$0.18, " +
      "'superseding the preview version'). Preferir SIEMPRE el id fechado en DeepInfra. Id CONFIRMADO en " +
      "catálogo real; config nativa tags structured-output+tools+json; ctx 1M; MoE 284B/13B activo. " +
      "GATE v3 (rúbrica intacta): reliability 20/20, CALIBRACIÓN FAIL laxer 25.0% [12.7-43.4] vs 20% — 7/28 " +
      "laxos de un escalón. GATE v4 (rúbrica mecánica, 'el modelo observa, el código juzga') — 5 corridas: " +
      "(1) v4-original laxer 10.7/stricter 60.7/DU exacta 32.1 — COMPRÓ el gate con severidad (el laxer-rate " +
      "unilateral casi nos come); (2) v4-bis (FIX 1 solid sin autocorrección + FIX 2 frontera) laxer " +
      "28.6/stricter 25.0/DU exacta 57.1 — EL MEJOR v4, no pasa el criterio de dos lados; (3-5) v4-ter/quart/" +
      "quint (con campo de trayectoria) 53.6-60.7% laxer — REGRESIÓN; la ablación quint probó que preguntarle " +
      "la trayectoria al modelo degrada su observación del último mensaje (none 0 vs GT 4, solid 16 vs GT 8); " +
      "trayectoria ABANDONADA (decisión del arquitecto 2026-08-11). REFERENCIA Sonnet-v3 (producción, medida " +
      "por el arquitecto con el mismo método): laxer 14.3/stricter 3.6/DU exacta 89.3/banda 89.3 — muy por " +
      "delante. El código v4 (packages/core/mechanical-rubric.ts, two-sided-calibration.ts) queda en el repo " +
      "como el intento documentado. **DISEÑO DE DOS MODELOS (decisión del founder, 2026-08-11): DeepSeek gobierna " +
      "la BANDA en vivo (cada turno, ~4s/llamada).** Exactitud de BANDA SOLA (calculada por el arquitecto con los " +
      "datos del gate): 75.0%, laxa 10.7%, estricta 14.3%, CERO errores de dos escalones — mucho mejor eligiendo " +
      "andamiaje (75%) que puntuando entendimiento (53.6% DU); residuo conservador (sub-emite minimal, da probing = " +
      "más apoyo del necesario). NO alimenta mastery (la allowlist solo tiene la tripleta de Qwen — la separación la " +
      "hace cumplir el deny-by-default). gateStatus por-tarea: { assessor: validated } (banda); " +
      "guided-items: pending_gate (closed beta 2026-09-07, flag estrecho; no O-14 de este schema — " +
      "Gemma colgó >180s, este modelo devolvió JSON útil en 47–57s). No marcar validated.",
    verifiedAt: "2026-08-11",
    verifiedBy: "gate_suite",
    gateStatus: { assessor: "validated", "guided-items": "pending_gate" },
  },

  // --- DeepInfra (Qwen/Qwen3.6-35B-A3B) — candidato assessor (encargo del founder), pending_gate ---
  {
    providerId: "deepinfra",
    modelId: "Qwen/Qwen3.6-35B-A3B",
    // PROVISIONAL, catálogo nativo (2026-08-11): tag "structured-output" + lever
    // supportsStructuredOutputs activo → json_schema debería aplicar. NO "none"
    // (structured.ts:105 haría skip). El gate mide el valor real.
    structuredOutputSupport: "native_schema",
    structuredOutputForce: null, // lever en provider.ts
    toolUse: true, // tag "tools" en catálogo — no medido por gate aún
    vision: true, // tag "multimodal"/"vlm" — la tarea assessor es de texto
    streaming: true,
    promptCaching: "none", // provisional, no medido
    maxContextTokens: null, // invariante registry.test.ts; valor REAL del catálogo: 262144 (ver notes)
    maxOutputTokens: null, // invariante
    pricePerMTokIn: 0.10,
    pricePerMTokOut: 0.95, // salida CARA — el assessor produce poco, verificar en la corrida
    costModel: "per-token",
    fixedCostRef: null,
    notes:
      "Candidato assessor encargado por el founder (2026-08-11). Id + precio CONFIRMADOS en catálogo real: " +
      "$0.10/$0.95 MTok, ctx 262144, tags structured-output+tools+json+reasoning. Trae reasoning_effort — el " +
      "barrido (reporte 13) mostró que NO es la palanca: latencia ~1 min/llamada en todos los niveles, costo " +
      "plano, y el default supera a low/medium/high en DU exacta (78.6% vs 71-75%). GATE v3: reliability 20/20. " +
      "**LAS DOS CORRIDAS DE CALIBRACIÓN, MISMA CONFIGURACIÓN: laxer 14.3% [5.7-31.5] (PASS) y 21.4% [10.2-39.5] " +
      "(FAIL por punto) — el modelo es estocástico y roza el umbral.** LECCIÓN DE MÉTODO: la concordancia exacta " +
      "se mantuvo en 78.6% en AMBAS mientras la laxitud saltó 7 puntos ⇒ la laxitud es la métrica más ruidosa y la " +
      "concordancia exacta la más estable. Promovido con evidencia que roza el umbral, POR DECISIÓN DEL FOUNDER; " +
      "riesgo acotado porque el mastery está en shadow (los veredictos no llegan al estudiante como estrellas — " +
      "margen para juntar datos reales antes de F4). ⚠️ COSTO: ~$0.115 por gate, 20× más caro que DeepSeek por " +
      "llamada. ⚠️ NO tiene prompt_cache (tags chat/vlm/vision/reasoning_effort/reasoning — la caché que el " +
      "founder pensaba sumar NO está disponible; DeepSeek sí la tiene). **DISEÑO DE DOS MODELOS (decisión del " +
      "founder): Qwen alimenta la EVIDENCIA DE MASTERY (muestreada, ~73s — la lentitud no importa porque se " +
      "acumula).** gateStatus por-tarea: { assessor: validated, judge: validated, mastery-assessor: validated } " +
      "— la allowlist de agregación usa el formato arreglado (deepinfra/Qwen/Qwen3.6-35B-A3B/buxo-assessor-v3, " +
      "parser por extremos en aggregate.ts).",
    verifiedAt: "2026-08-11",
    verifiedBy: "gate_suite",
    gateStatus: { assessor: "validated", judge: "validated", "mastery-assessor": "validated" },
  },

  // --- DeepInfra (google/gemma-4-26B-A4B-it) — candidato assessor (encargo del founder), pending_gate ---
  {
    providerId: "deepinfra",
    modelId: "google/gemma-4-26B-A4B-it",
    structuredOutputSupport: "native_schema", // PROVISIONAL, catálogo + lever — el gate mide el valor real
    structuredOutputForce: null, // lever en provider.ts
    toolUse: true, // tag "tools" en catálogo — no medido por gate aún
    vision: true, // tag "multimodal" en catálogo — la tarea assessor es de texto
    streaming: true,
    promptCaching: "none", // provisional, no medido
    maxContextTokens: null, // invariante; valor REAL del catálogo: 262144 (ver notes)
    maxOutputTokens: null,
    pricePerMTokIn: 0.07,
    pricePerMTokOut: 0.34,
    costModel: "per-token",
    fixedCostRef: null,
    notes:
      "Candidato assessor encargado por el founder (2026-08-11). Id + precio CONFIRMADOS en catálogo real: " +
      "$0.07/$0.34 MTok, ctx 262144, tags structured-output+tools+json. GATE v3 (2026-08-11, reporte 11): " +
      "reliability 20/20; CALIBRACIÓN **FAIL laxer 60.7% [42.4-76.4]** — idéntico al de gemma-4-31B-it: la familia " +
      "COLLAPSA la distribución (solid 20 vs GT 8, developing 2 vs GT 11, weak 1 vs GT 5 — no emite la mitad baja " +
      "de la escala). DU exacta 46.4%, banda 42.9%, 3 errores de 2+ escalones. $0.0090. La expectativa baja del " +
      "arquitecto se confirmó con datos. pending_gate (no sirve assessor).",
    verifiedAt: "2026-08-11",
    verifiedBy: "gate_suite",
    gateStatus: "pending_gate",
  },
];

// Fail-loud on the registry's OWN shape at import time: a malformed row here
// is a bug in this file, and should crash immediately, not surface later as
// a confusing zod error deep inside loadModelsConfig.
//
// PB2 invariant (F3 G5 extended): toda fila con gateStatus="validated" (valor
// único o mapa por-tarea con ALGUNA tarea validated) DEBE tener su costo
// correctamente atribuido — ningún modelo validado puede subcontar costos en
// silencio.
//
// - costModel="per-token": exige pricePerMTokIn/Out no null (invariante
//   original PB2). Un modelo validado para producción sin precio causaría
//   subconteo silencioso en cost_usd_estimate.
// - costModel="self-hosted": exige pricePerMTokIn/Out null (no hay precio
//   por token) Y fixedCostRef no null (atribución de costo fijo mensual).
//   Un modelo self-hosted validado sin fixedCostRef causaría subconteo
//   silencioso del costo de infraestructura.
//
// pending_gate con precio null está permitido en ambos modos (costo
// desconocido en desarrollo es aceptable).
//
// NOTA (F3, 2026-08-11): con gateStatus por-tarea, "validated" en UN mapa
// parcial es suficiente para exigir el costo — un modelo validated para
// tutor ya sirve tráfico y no puede subcontar.
ModelCapabilitiesSchema.array()
  .superRefine((rows, ctx) => {
    for (const [i, row] of rows.entries()) {
      const validatedAnywhere =
        typeof row.gateStatus === "string"
          ? row.gateStatus === "validated"
          : Object.values(row.gateStatus).includes("validated");
      if (!validatedAnywhere) continue;

      if (row.costModel === "per-token") {
        if (row.pricePerMTokIn === null || row.pricePerMTokOut === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `Row ${i} (${row.providerId}/${row.modelId}): gateStatus="validated", ` +
              `costModel="per-token" but pricePerMTokIn=${row.pricePerMTokIn}, ` +
              `pricePerMTokOut=${row.pricePerMTokOut}. ` +
              `A validated per-token model MUST have known pricing — set both prices or change gateStatus to "pending_gate".`,
            path: [i],
          });
        }
      } else if (row.costModel === "self-hosted") {
        if (row.pricePerMTokIn !== null || row.pricePerMTokOut !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `Row ${i} (${row.providerId}/${row.modelId}): gateStatus="validated", ` +
              `costModel="self-hosted" but pricePerMTokIn=${row.pricePerMTokIn}, ` +
              `pricePerMTokOut=${row.pricePerMTokOut}. ` +
              `A self-hosted model MUST have null prices (no per-token cost).`,
            path: [i],
          });
        }
        if (row.fixedCostRef === null || row.fixedCostRef === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `Row ${i} (${row.providerId}/${row.modelId}): gateStatus="validated", ` +
              `costModel="self-hosted" but fixedCostRef=${JSON.stringify(row.fixedCostRef)}. ` +
              `A validated self-hosted model MUST have a fixedCostRef pointing to the D3 infrastructure line item.`,
            path: [i],
          });
        }
      }
    }
  })
  .parse(MODEL_REGISTRY);

const REGISTRY_BY_KEY: ReadonlyMap<string, ModelCapabilities> = new Map(
  MODEL_REGISTRY.map((row) => [modelRefKey(row.providerId, row.modelId), row]),
);

export function lookupCapabilities(providerId: string, modelId: string): ModelCapabilities | undefined {
  return REGISTRY_BY_KEY.get(modelRefKey(providerId, modelId));
}

/**
 * Fail-loud lookup — throws `ModelsConfigError` (with the offending pair
 * embedded, per the mandatory gate test) instead of returning `undefined`.
 * `task` is required purely to make the thrown message actionable (which
 * env var / config key to go fix).
 */
export function requireCapabilities(task: TaskKind, ref: ModelRef): ModelCapabilities {
  const row = lookupCapabilities(ref.providerId, ref.modelId);
  if (!row) throw unregisteredModelError(task, ref);
  return row;
}

/**
 * Piso no configurable (§1.3): "Sonnet 5 para tutor/assessor/judge, Haiku
 * 4-5 para ingesta". `safety` is this package's extrapolation (see
 * task.ts's module doc) of §3.1's "mismo modelo/peldaño barato" — Haiku,
 * same as ingest.
 *
 * `temario-builder`'s row is kept here for type completeness (every
 * `TaskKind` must have an entry) but is UNREACHABLE in practice: P2 FIX1
 * (`config.ts`'s `resolveChainForTask`) makes `skipFloor` unconditional for
 * this task, so the floor is never appended to its chain. A stateful,
 * multi-step tool-calling builder is not failover-safe — see the FIX1
 * comment in `config.ts` for why.
 */
export const DEFAULT_FLOOR: Readonly<Record<TaskKind, ModelRef>> = {
  tutor: { providerId: "anthropic", modelId: "claude-sonnet-5" },
  assessor: { providerId: "anthropic", modelId: "claude-sonnet-5" },
  judge: { providerId: "anthropic", modelId: "claude-sonnet-5" },
  ingest: { providerId: "anthropic", modelId: "claude-haiku-4-5" },
  safety: { providerId: "anthropic", modelId: "claude-haiku-4-5" },
  "temario-builder": { providerId: "anthropic", modelId: "claude-sonnet-5" },
  // mastery-assessor: NUNCA se appendea (skipFloor en config.ts, como
  // temario-builder) — si el modelo configurado (Qwen) falla, la muestra se
  // pierde RUIDOSO en vez de caer a Anthropic. La entrada existe solo para
  // satisfacer la invariante "todo TaskKind tiene floor en el registry".
  "mastery-assessor": { providerId: "anthropic", modelId: "claude-sonnet-5" },
  // guided-items: skipFloor in config.ts — this entry exists only for the
  // "every TaskKind has a floor" invariant. DeepSeek-V4-Flash-0731 is
  // pending_gate for this task (no O-14); prod/closed beta must set
  // BUXO_GUIDED_ITEMS_CHAIN plus BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE.
  // Empty config → [] (fail loud), never a silent Anthropic floor.
  "guided-items": { providerId: "deepinfra", modelId: "deepseek-ai/DeepSeek-V4-Flash-0731" },
};
