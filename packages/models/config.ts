/**
 * Selección por tarea, configuración por entorno, fallback — C-backend-
 * plataforma.md §1.3.
 *
 * The central fail-loud invariant lives here: `loadModelsConfig` is called
 * ONCE at server boot (WP5), validates every configured chain entry against
 * the capabilities registry, and THROWS immediately if any pair is
 * unregistered — never at call time, never degraded. This is a more literal
 * reading of "C7 falla fuerte al CARGAR la configuración del servidor" than
 * a `resolveChain(task, env)` that re-validates on every call would be:
 * loading is a single event, and `resolveChain` here is a cheap accessor
 * into its already-validated result (see the DEVIATION note below).
 */
import { z } from "zod";
import { ModelRefSchema, TASK_KINDS, type Environment, type ModelRef, type TaskKind, modelRefEquals } from "./task";
import { DEFAULT_FLOOR, requireCapabilities } from "./registry";
import { gateStatusForTask, isServableForTask } from "./gate";
import { ModelsConfigError } from "./errors";

function formatChainForError(chain: readonly ModelRef[]): string {
  return chain.map((ref) => `${ref.providerId}:${ref.modelId}`).join(",");
}

const ChainInputSchema = z.union([z.string(), z.array(ModelRefSchema)]);

/**
 * Raw config shape, keyed by task — mirrors the env var naming in §1.3
 * (`BUXO_TUTOR_CHAIN`, `BUXO_ASSESSOR_CHAIN`, ...): WP5 reads those env
 * vars and assembles this object (or a JSON blob shaped like it) before
 * calling `loadModelsConfig`. Each value is either the raw
 * `"provider:model,provider:model"` string or an already-parsed
 * `ModelRef[]` (useful for tests/non-env sources).
 */
export const RawModelsConfigSchema = z
  .object({
    tutor: ChainInputSchema.optional(),
    assessor: ChainInputSchema.optional(),
    judge: ChainInputSchema.optional(),
    ingest: ChainInputSchema.optional(),
    safety: ChainInputSchema.optional(),
    temarioBuilder: ChainInputSchema.optional(),
    masteryAssessor: ChainInputSchema.optional(),
    guidedItems: ChainInputSchema.optional(),
  })
  .strict();
export type RawModelsConfig = z.infer<typeof RawModelsConfigSchema>;

export interface ResolvedModelsConfig {
  environment: Environment;
  devAllowPendingGate: boolean;
  chains: Readonly<Record<TaskKind, readonly ModelRef[]>>;
}

/**
 * Parses `"provider:model,provider:model,..."` (§1.3's env var format).
 * Returns `null` for an EMPTY or MALFORMED string (no colon in an entry,
 * empty provider/model half, etc.) rather than throwing — §1.3 is explicit
 * that a malformed/empty chain from a bad deploy must fall back to the
 * hardcoded floor, NOT crash the server. This is a deliberately different
 * failure mode from "well-formed pair not in the registry", which DOES
 * throw (see `resolveChainForTask` below) — parsing malformed input is a
 * typo, an unregistered pair is a missing fact C7 refuses to guess at.
 */
export function parseChainString(raw: string): ModelRef[] | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const entries = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (entries.length === 0) return null;

  const refs: ModelRef[] = [];
  for (const entry of entries) {
    const colonIndex = entry.indexOf(":");
    if (colonIndex <= 0 || colonIndex === entry.length - 1) return null;
    const providerId = entry.slice(0, colonIndex).trim();
    const modelId = entry.slice(colonIndex + 1).trim();
    if (!providerId || !modelId) return null;
    refs.push({ providerId, modelId });
  }
  return refs;
}

function resolveChainForTask(
  task: TaskKind,
  rawEntry: string | ModelRef[] | undefined,
  environment: Environment,
  devAllowPendingGate: boolean,
  tutorFailoverFloor: "sonnet" | "none" = "sonnet",
  guidedItemsAllowPendingGate = false,
): ModelRef[] {
  const parsed: ModelRef[] | null =
    rawEntry === undefined
      ? null
      : Array.isArray(rawEntry)
        ? rawEntry.length > 0
          ? rawEntry
          : null
        : parseChainString(rawEntry);

  const configured = parsed ?? [];

  // P2 FIX1 (2026-07-21, post-real-run REVIEW): the temario-builder is a
  // STATEFUL multi-step tool-calling loop — each step commits real DB rows
  // (createTopic/createMilestone) via side-effecting tools. A cross-model
  // failover mid-construction (the bug hit in the real Haiku run) restarts
  // the whole tool loop from scratch on a DIFFERENT model, which then
  // collides with the rows the FIRST model already committed. Failover is
  // safe for stateless calls (tutor reply, structured assess/judge output,
  // ingest transcription) precisely because those have no partial
  // server-side side effects to duplicate — the builder does. So a
  // multi-model chain for THIS task is unsupported outright (see the guard
  // right below), and no floor is ever appended to it — a builder chain is
  // always the raw configured chain, nothing more.
  if (task === "temario-builder" && configured.length > 1) {
    throw new ModelsConfigError(
      `@buxo/models config error: "temario-builder" does not support a multi-model chain ` +
        `(got "${formatChainForError(configured)}"). The builder runs a stateful, multi-step ` +
        `tool-calling loop with side-effecting DB writes per step; failing over to a second ` +
        `model mid-construction would restart the loop and collide with rows the first model ` +
        `already committed (P2 real-run bug, 2026-07-21). Configure exactly one model in ` +
        `BUXO_TEMARIO_BUILDER_CHAIN.`,
    );
  }

  // Fail-loud (§1.2's core invariant): every EXPLICITLY configured entry
  // must have a registry row. Throws ModelsConfigError with the offending
  // pair embedded — this is what the mandatory gate test asserts.
  for (const ref of configured) {
    requireCapabilities(task, ref);
  }

  const floor = DEFAULT_FLOOR[task];
  const chain = [...configured];

  // Beta externa (BE2 decision, 2026-07-18): cuando tutorFailoverFloor="none",
  // el piso Sonnet NO se appendea al tutor. Si el modelo configurado falla,
  // la petición falla RUIDOSO (ModelChainExhaustedError) en vez de caer
  // silenciosamente a Anthropic. Assessor/judge/ingest/safety inalterados.
  //
  // P2 FIX1: temario-builder NEVER gets the floor appended, unconditionally
  // (not configurable — see the module-doc-length comment above). This is
  // deliberately a stronger, non-opt-outable version of the tutor's
  // `tutorFailoverFloor` escape hatch: a builder mid-construction is never
  // failover-safe, so there is no "sonnet" mode to fall back to for it.
  //
  // mastery-assessor (diseño de dos modelos, 2026-08-11): tampoco recibe piso
  // — si el modelo configurado (Qwen) falla, la MUESTRA se pierde RUIDOSO en
  // vez de caer a Anthropic. La directiva "Anthropic sale por completo de la
  // ruta del estudiante" no admite un piso Sonnet en la cadena de mastery.
  //
  // assessor (banda) — MISMO trato desde 2026-08-11. Se pasó por alto al
  // cerrar la migración y lo cazó el arquitecto revisando el artefacto: con
  // el piso puesto, un fallo de DeepSeek caía a Sonnet EN SILENCIO. No es un
  // centavo: la política de privacidad v3 declara a DeepInfra como ÚNICO
  // proveedor de IA, así que ese piso volvía falso un documento publicado —
  // el mismo error que ya hubo que corregir cuando la política declaraba el
  // judge apagado mientras corría (`legal/documents.ts`). Un turno sin banda
  // es recuperable (persiste la anterior); un gasto invisible que además
  // desmiente a la política, no.
  const skipFloor =
    task === "temario-builder" ||
    task === "mastery-assessor" ||
    task === "assessor" ||
    task === "guided-items" ||
    (task === "tutor" && tutorFailoverFloor === "none");

  if (!skipFloor) {
    // "La ruta directa a Anthropic es una entrada más de la cadena ... el
    // agregador no puede ser punto único de falla" — 02-validacion-arquitecto.md,
    // "Ruta directa de respaldo (backend Q6): sí". The floor is always
    // present in the resolved chain (appended if the configured chain
    // doesn't already include it anywhere), which also satisfies §1.3's
    // "cadena vacía/mal formada -> cae al piso" for the empty case.
    if (!chain.some((ref) => modelRefEquals(ref, floor))) {
      chain.push(floor);
    }
  }

  // Gate enforcement (§1.4 / vision doc principio 7 — architect's ruling
  // 2026-07-14): pending_gate candidates are dropped from EVERY task's
  // chain outside dev+flag. The floor is always gateStatus "validated"
  // (registry.ts), so `gated` can never come back empty (unless skipFloor).
  const gated = chain.filter((ref) => {
    const capabilities = requireCapabilities(task, ref);
    if (isServableForTask(capabilities, task, environment, devAllowPendingGate)) return true;
    // Narrow closed-beta opt-in: serve THIS task's pending_gate row in
    // prod/staging without opening BUXO_DEV_ALLOW_PENDING_GATE (illegal
    // outside dev) or marking the task validated without a gate.
    return (
      task === "guided-items" &&
      guidedItemsAllowPendingGate &&
      gateStatusForTask(capabilities, task) === "pending_gate"
    );
  });

  if (gated.length > 0) return gated;
  // Con skipFloor, si la cadena queda vacía devolvemos [] — el failover
  // engine lanzará ModelChainExhaustedError en call time (fallo ruidoso).
  return skipFloor ? [] : [floor];
}

export interface LoadModelsConfigInput {
  /** Parsed against `RawModelsConfigSchema` — pass a plain object (env-var-derived or JSON.parse'd). */
  raw: unknown;
  environment: Environment;
  /**
   * Opt-in escape hatch to let a founder exercise an ungated candidate
   * locally (§1.4, O-14 point 5's "0% de tráfico ... ramp gradual").
   * Only valid when `environment === "dev"` — passing `true` in any other
   * environment is itself a config error and throws immediately, because
   * this flag must never leak into staging/prod.
   */
  devAllowPendingGate?: boolean;
  /**
   * Beta externa (BE2 decision, 2026-07-18): controla si el piso Sonnet se
   * appendea a la cadena del tutor como failover. "sonnet" (default) preserva
   * el comportamiento actual — el piso Sonnet siempre está presente. "none"
   * elimina el piso del tutor: si el modelo configurado falla, la petición
   * falla RUIDOSO (ModelChainExhaustedError) en vez de caer silenciosamente a
   * Anthropic. Esto protege la directiva del founder de que Anthropic solo
   * gaste por la vía del assessor, capeada por cuota.
   *
   * Solo afecta al tutor. El assessor/judge/ingest/safety quedan inalterados
   * (su piso Sonnet/Haiku sigue presente).
   */
  tutorFailoverFloor?: "sonnet" | "none";
  /**
   * Narrow closed-beta opt-in to serve `guided-items` while DeepSeek-V4-Flash-0731
   * is still `pending_gate` for that task. Unlike `devAllowPendingGate`, this MAY be
   * true in staging/prod — it does not ungate any other task.
   */
  guidedItemsAllowPendingGate?: boolean;
}

export function loadModelsConfig(input: LoadModelsConfigInput): ResolvedModelsConfig {
  const devAllowPendingGate = input.devAllowPendingGate ?? false;
  const tutorFailoverFloor = input.tutorFailoverFloor ?? "sonnet";
  const guidedItemsAllowPendingGate = input.guidedItemsAllowPendingGate ?? false;

  if (devAllowPendingGate && input.environment !== "dev") {
    throw new ModelsConfigError(
      `@buxo/models config error: devAllowPendingGate=true is only valid in the "dev" environment ` +
        `(got "${input.environment}"). This flag exists to let a founder try an ungated candidate ` +
        `locally (C-backend-plataforma.md §1.4, O-14) — it must never reach staging/prod.`,
    );
  }

  const parseResult = RawModelsConfigSchema.safeParse(input.raw ?? {});
  if (!parseResult.success) {
    throw new ModelsConfigError(`@buxo/models config error: malformed models config — ${parseResult.error.message}`);
  }
  const raw = parseResult.data;

  const chains = Object.fromEntries(
    TASK_KINDS.map((task) => {
      const rawKey =
        task === "temario-builder"
          ? "temarioBuilder"
          : task === "mastery-assessor"
            ? "masteryAssessor"
            : task === "guided-items"
              ? "guidedItems"
              : task;
      return [
        task,
        resolveChainForTask(
          task,
          raw[rawKey],
          input.environment,
          devAllowPendingGate,
          tutorFailoverFloor,
          guidedItemsAllowPendingGate,
        ),
      ];
    }),
  ) as Record<TaskKind, ModelRef[]>;

  return { environment: input.environment, devAllowPendingGate, chains };
}

/** Cheap accessor into an already-loaded (and thus already-validated) config — see the module doc above. */
export function resolveChain(config: ResolvedModelsConfig, task: TaskKind): readonly ModelRef[] {
  return config.chains[task];
}
