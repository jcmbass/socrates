/**
 * Materials route — C-backend §2.4:
 *   `POST /v1/materials multipart (bytes) o { kind:"paste", text } → MaterialAsset (status:"pending")`
 *
 * F2 WQ1 (`docs/plan-app-multiplataforma/05-plan-f2.md` Ola 1) activates
 * the WP5 multipart placeholder documented below into a real digestion —
 * see `../materials/pipeline.ts`'s module doc for the full endpoint
 * contract (as built).
 *
 * F2 WQ2 Part 1 adds SUBSET mode (`mode: "subset"` form field): the
 * bandwidth-saving page-subset upload the WQ1 report's §5 flagged as
 * deferred (`apps/mobile`'s client, added this wave, is the first real
 * consumer). Full-PDF mode (`mode` absent or `"full"`) is UNCHANGED —
 * see `../materials/pipeline.ts`'s module doc for both modes' contracts.
 *
 * WP5 history (kept for context): `kind:"paste"` digests synchronously (it
 * already IS plain text, nothing to extract) and returns `status:"ready"`;
 * a multipart PDF upload used to be accepted and stored as `status:"pending"`
 * but never transition further — no worker existed to advance it. That gap
 * is what WQ1 closed for `kind === "pdf"`. Multipart photo/txt
 * uploads still fall back to the old `status:"pending"` placeholder — C4's
 * image-ingest path (`ingestImage`) and plain-text passthrough are out of
 * scope for this wave (DF-7/F2 is specifically the PDF Tier-2 raster
 * path); flagged for the next wave that touches those kinds.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { InvalidPDFException } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { errorResponse } from "../errors";
import { claimOrCreateMaterial, beginMaterialDigest, completeMaterialDigest, failMaterialDigest, findMaterialById, listMaterialsBySubject } from "../repositories/materials";
import { findSubjectById } from "../repositories/subjects";
import { findUserById } from "../repositories/users";
import { checkIngestQuota, recordQuotaUsage } from "../quota/enforce";
import { createQuotaRejection } from "../repositories/quota-rejections";
import { createSafetyIncident } from "../repositories/safety-incidents";
import {
  digestMaterialPdf,
  digestMaterialSubset,
  MaterialIngestQuotaExceededError,
  MaterialSafetyBlockedError,
  MaterialSubsetManifestError,
  MaterialTooLargeError,
  type MaterialPageManifestEntry,
  type SubsetPageManifestEntry,
} from "../materials/pipeline";
import { MAX_PAGES_PER_REQUEST, MAX_UPLOAD_PDF_BYTES } from "../raster/limits";
import { RasterPageTooLargeError } from "../raster/rasterizer";

const PasteBodySchema = z.object({
  kind: z.literal("paste"),
  subjectId: z.string().min(1),
  text: z.string().min(1),
  /** Optional — same spirit as multipart `clientUploadId`. Old clients omit it. */
  clientUploadId: z.string().min(1).max(128).optional(),
});

const PageManifestSchema = z
  .array(
    z.object({
      pageNumber: z.number().int().positive(),
      claimedTier: z.enum(["local", "cloud"]),
    }),
  )
  .optional();

/** Subset mode's richer manifest (WQ2 Part 1): unlike full-PDF mode's PageManifestSchema (accepted, never trusted for routing), this one IS load-bearing — `localText` is the only source of text for pages whose bytes never arrive (module doc's "SUBSET MODE CONTRACT"). Zod validates shape only; `claimedTier === "local"` requiring a non-null `localText` is a pipeline-level invariant (`../materials/pipeline.ts`'s `validateSubsetInput`), not duplicated here. */
const SubsetPageManifestSchema = z.array(
  z.object({
    pageNumber: z.number().int().positive(),
    claimedTier: z.enum(["local", "cloud"]),
    localText: z.string().nullish(),
  }),
);

const MAX_PASTE_CHARS = 200_000;

/** F2 WQ1's digestion pipeline version tag — O-9-style provenance, bumped whenever the pipeline's behavior changes materially. */
const WQ1_PIPELINE_VERSION = "f2-wq1-server-raster-v1";

/** F2 WQ2 Part 1's subset-mode pipeline version tag — distinct from WQ1_PIPELINE_VERSION so a persisted MaterialAsset always records which upload shape produced it. */
const WQ2_SUBSET_PIPELINE_VERSION = "f2-wq2-subset-v1";

/** Subset mode's cloud-page file fields are named `cloudPage-<pageNumber>` (module doc: "single-page PDFs extracted client-side", one file field per cloud-tier page — self-describing, no extra JSON needed to match files to page numbers). */
const CLOUD_PAGE_FIELD_RE = /^cloudPage-(\d+)$/;

type MultipartForm = Record<string, string | File | (string | File)[]>;

/** Shared by full-PDF mode and subset mode — both `digestMaterialPdf` and `digestMaterialSubset` throw the same error vocabulary (plus subset-only `MaterialSubsetManifestError`). */
async function respondToPipelineError(
  c: Context<{ Variables: AuthVariables }>,
  deps: AppDeps,
  userId: string,
  subjectId: string,
  err: unknown,
) {
  if (err instanceof MaterialTooLargeError || err instanceof MaterialSubsetManifestError) {
    return errorResponse(c, "invalid_request", err.message);
  }
  if (err instanceof RasterPageTooLargeError) {
    return errorResponse(
      c,
      "raster_page_too_large",
      `Page ${err.pageNumber} is too large to rasterize (${err.pixels}px exceeds the ${err.max}px limit)`,
    );
  }
  if (err instanceof MaterialIngestQuotaExceededError) {
    await createQuotaRejection(deps.db, {
      userId,
      reason: err.reason,
      surface: "ingest",
    });
    return errorResponse(c, "quota_exceeded", `Ingest quota exceeded (${err.reason})`);
  }
  if (err instanceof MaterialSafetyBlockedError) {
    const incident = await createSafetyIncident(deps.db, {
      userId,
      // No StudySession exists for a material upload — sentinel per
      // ../safety/incident.ts's module doc ("kept here rather than added
      // to @buxo/domain since B3 never modeled this entity").
      sessionId: `material-upload:${subjectId}`,
      exchangeId: null,
      category: err.category,
      classifierProviderId: err.classifierProviderId,
      classifierModelId: err.classifierModelId,
    });
    await deps.safetyNotifier.notify(incident);
    return errorResponse(c, "safety_blocked", `Material transcription blocked (page ${err.pageNumber}, category=${err.category})`);
  }
  if (err instanceof InvalidPDFException) {
    return errorResponse(c, "invalid_request", "Uploaded file is not a valid PDF");
  }
  throw err;
}

/** Optional form field — same spirit as turn `clientMessageId` (beta-real 10). Old APKs omit it. */
function readClientUploadId(form: MultipartForm): string | null {
  const raw = form.clientUploadId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  return trimmed;
}

/**
 * Subset mode (F2 WQ2 Part 1) — see `../materials/pipeline.ts`'s module doc
 * for the full trust-policy contract. Multipart fields, in addition to
 * `subjectId`/`mode=subset`:
 *   - `totalPages`: string-encoded positive integer, the original
 *     document's page count.
 *   - `pages`: JSON `SubsetPageManifestEntry[]` (§ pipeline.ts), one entry
 *     per page `1..totalPages`. REQUIRED (unlike full mode's decorative,
 *     ignored `pages` field) — this is the only source of text for pages
 *     whose bytes never arrive.
 *   - `cloudPage-<pageNumber>`: one File field per manifest row with
 *     `claimedTier: "cloud"` — a single-page PDF, independently valid,
 *     extracted client-side.
 *   - `originalFilename` (optional): display name for the persisted
 *     `MaterialAsset` (subset mode has no single uploaded file to derive
 *     one from).
 *   - `clientUploadId` (optional): idempotency key — claim BEFORE digest.
 */
async function handleSubsetUpload(
  c: Context<{ Variables: AuthVariables }>,
  deps: AppDeps,
  userId: string,
  subjectId: string,
  subjectName: string,
  form: MultipartForm,
) {
  const totalPagesField = form.totalPages;
  const totalPages = typeof totalPagesField === "string" ? Number.parseInt(totalPagesField, 10) : NaN;
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    return errorResponse(c, "invalid_request", `totalPages form field must be a positive integer, got ${JSON.stringify(totalPagesField)}`);
  }
  if (totalPages > MAX_PAGES_PER_REQUEST) {
    return errorResponse(c, "invalid_request", `${totalPages} pages exceeds the ${MAX_PAGES_PER_REQUEST}-page limit per upload`);
  }

  const pagesField = form.pages;
  if (typeof pagesField !== "string" || pagesField.length === 0) {
    return errorResponse(c, "invalid_request", `pages manifest is required in subset mode`);
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(pagesField);
  } catch {
    return errorResponse(c, "invalid_request", `pages manifest is not valid JSON`);
  }
  const parsedManifest = SubsetPageManifestSchema.safeParse(manifestJson);
  if (!parsedManifest.success) {
    return errorResponse(c, "invalid_request", `Malformed "pages" manifest: ${parsedManifest.error.message}`);
  }
  const manifest: SubsetPageManifestEntry[] = parsedManifest.data.map((e) => ({
    pageNumber: e.pageNumber,
    claimedTier: e.claimedTier,
    localText: e.localText ?? null,
  }));

  const cloudPageBytes = new Map<number, Uint8Array>();
  for (const [key, value] of Object.entries(form)) {
    const match = CLOUD_PAGE_FIELD_RE.exec(key);
    if (!match) continue;
    if (!(value instanceof File)) {
      return errorResponse(c, "invalid_request", `${key} must be a file`);
    }
    if (value.size === 0) {
      return errorResponse(c, "invalid_request", `${key} is empty`);
    }
    if (value.size > MAX_UPLOAD_PDF_BYTES) {
      return errorResponse(c, "invalid_request", `${key} exceeds the ${MAX_UPLOAD_PDF_BYTES}-byte limit`);
    }
    cloudPageBytes.set(Number.parseInt(match[1], 10), new Uint8Array(await value.arrayBuffer()));
  }

  const user = await findUserById(deps.db, userId);
  if (!user) return errorResponse(c, "not_found", "User not found");

  const originalFilename = typeof form.originalFilename === "string" ? form.originalFilename : null;
  const clientUploadId = readClientUploadId(form);
  const claim = await beginMaterialDigest(deps.db, {
    userId,
    subjectId,
    kind: "pdf",
    originalFilename,
    digestionPipelineVersion: WQ2_SUBSET_PIPELINE_VERSION,
    clientUploadId,
    now: deps.now(),
  });
  if (claim.kind === "duplicate") {
    return errorResponse(c, "duplicate_material", "This material upload was already received");
  }
  const claimed = claim.material;

  try {
    const result = await digestMaterialSubset(
      { subject: subjectName, totalPages, manifest, cloudPageBytes },
      {
        rasterizer: deps.rasterizer,
        models: deps.models.raw,
        safetyClassifier: deps.safetyClassifier,
        checkIngestQuota: async (cloudPageCount) => {
          const check = await checkIngestQuota(deps.db, userId, user.accountKind, deps.quotaConfig, cloudPageCount, deps.now());
          return check.ok ? { ok: true } : { ok: false, reason: check.reason };
        },
        recordIngestUsage: async (costUsd) => {
          const check = await checkIngestQuota(deps.db, userId, user.accountKind, deps.quotaConfig, 0, deps.now());
          if (check.ok) await recordQuotaUsage(deps.db, check.quotas, "ingest", costUsd);
        },
      },
    );

    const material = await completeMaterialDigest(deps.db, userId, claimed.id, {
      digestedText: result.assembledText,
      status: result.status,
      processingReport: result.processingReport,
      digestionPipelineVersion: WQ2_SUBSET_PIPELINE_VERSION,
    });
    return c.json(material ?? claimed, 201);
  } catch (err) {
    await failMaterialDigest(deps.db, userId, claimed.id).catch(() => undefined);
    return respondToPipelineError(c, deps, userId, subjectId, err);
  }
}

/**
 * Same ownership gate as temarios/fuentes: subject must exist AND belong
 * to the caller. Returns null → route answers 404 (no existence leak).
 */
async function loadSubjectAndCheckOwnership(db: AppDeps["db"], userId: string, subjectId: string) {
  const subject = await findSubjectById(db, subjectId);
  if (!subject || subject.userId !== userId) return null;
  return subject;
}

export function createMaterialsRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  /**
   * GET /v1/materials?subjectId=… — list the caller's materials for one
   * subject (reconcile orphans after a killed client mid-ingest). Auth-
   * scoped: subject ownership + repository userId filter. Must be
   * registered before `/:id` so "materials" collection matching wins.
   */
  app.get("/", async (c) => {
    const userId = c.get("userId");
    const subjectId = c.req.query("subjectId");
    if (!subjectId) {
      return errorResponse(c, "invalid_request", "subjectId query parameter is required");
    }
    const subject = await loadSubjectAndCheckOwnership(deps.db, userId, subjectId);
    if (!subject) return errorResponse(c, "not_found", "Subject not found");

    const materials = await listMaterialsBySubject(deps.db, userId, subject.id, deps.now());
    return c.json(materials);
  });

  app.post("/", async (c) => {
    const userId = c.get("userId");
    const contentType = c.req.header("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.parseBody({ all: true });
      const subjectId = form.subjectId;
      if (typeof subjectId !== "string" || !subjectId) {
        return errorResponse(c, "invalid_request", "subjectId form field is required");
      }
      const subject = await findSubjectById(deps.db, subjectId);
      if (!subject || subject.userId !== userId) return errorResponse(c, "not_found", "Subject not found");

      if (form.mode === "subset") {
        return handleSubsetUpload(c, deps, userId, subjectId, subject.name, form);
      }

      const file = form.file;
      if (!(file instanceof File)) {
        return errorResponse(c, "invalid_request", "file form field is required");
      }

      const kind = file.type === "application/pdf" ? "pdf" : file.type.startsWith("image/") ? "photo" : "txt";

      if (kind !== "pdf") {
        // Photo/txt digestion pipelines are out of scope for F2 WQ1 (DF-7 is
        // specifically the PDF Tier-2 raster path) — same WP5 placeholder
        // behavior as before for these two kinds. clientUploadId still
        // claims the row so a retry does not duplicate.
        const clientUploadId = readClientUploadId(form);
        const claim = await claimOrCreateMaterial(deps.db, {
          userId,
          subjectId,
          kind,
          originalFilename: file.name || null,
          digestedText: "",
          status: "pending",
          clientUploadId,
        });
        if (claim.kind === "duplicate") {
          return errorResponse(c, "duplicate_material", "This material upload was already received");
        }
        return c.json(claim.material, 201);
      }

      const pdfBytes = new Uint8Array(await file.arrayBuffer());
      if (pdfBytes.length === 0) {
        return errorResponse(c, "invalid_request", "Uploaded PDF is empty");
      }
      if (pdfBytes.length > MAX_UPLOAD_PDF_BYTES) {
        return errorResponse(c, "invalid_request", `PDF exceeds the ${MAX_UPLOAD_PDF_BYTES}-byte limit`);
      }

      let clientPageManifest: MaterialPageManifestEntry[] | undefined;
      const pagesField = form.pages;
      if (typeof pagesField === "string" && pagesField.length > 0) {
        const parsedManifest = PageManifestSchema.safeParse(JSON.parse(pagesField));
        if (!parsedManifest.success) {
          return errorResponse(c, "invalid_request", `Malformed "pages" manifest: ${parsedManifest.error.message}`);
        }
        clientPageManifest = parsedManifest.data;
      }

      const user = await findUserById(deps.db, userId);
      if (!user) return errorResponse(c, "not_found", "User not found");

      // Claim BEFORE digest so a mid-flight retry cannot double-charge, and
      // so GET /v1/materials can see status:"digesting" while we work.
      const clientUploadId = readClientUploadId(form);
      const claim = await beginMaterialDigest(deps.db, {
        userId,
        subjectId,
        kind: "pdf",
        originalFilename: file.name || null,
        digestionPipelineVersion: WQ1_PIPELINE_VERSION,
        clientUploadId,
        now: deps.now(),
      });
      if (claim.kind === "duplicate") {
        return errorResponse(c, "duplicate_material", "This material upload was already received");
      }
      const claimed = claim.material;

      try {
        const result = await digestMaterialPdf(
          { pdfBytes, subject: subject.name, clientPageManifest },
          {
            rasterizer: deps.rasterizer,
            models: deps.models.raw,
            safetyClassifier: deps.safetyClassifier,
            checkIngestQuota: async (cloudPageCount) => {
              const check = await checkIngestQuota(deps.db, userId, user.accountKind, deps.quotaConfig, cloudPageCount, deps.now());
              return check.ok ? { ok: true } : { ok: false, reason: check.reason };
            },
            recordIngestUsage: async (costUsd) => {
              // Re-derive the SAME quota rows checkIngestQuota already loaded
              // (get-or-create is idempotent, §I-10) so usage recording
              // shares the exact (daily, monthly) row pair the check used.
              const check = await checkIngestQuota(deps.db, userId, user.accountKind, deps.quotaConfig, 0, deps.now());
              if (check.ok) await recordQuotaUsage(deps.db, check.quotas, "ingest", costUsd);
            },
          },
        );

        const material = await completeMaterialDigest(deps.db, userId, claimed.id, {
          digestedText: result.assembledText,
          status: result.status,
          processingReport: result.processingReport,
          digestionPipelineVersion: WQ1_PIPELINE_VERSION,
        });
        return c.json(material ?? claimed, 201);
      } catch (err) {
        await failMaterialDigest(deps.db, userId, claimed.id).catch(() => undefined);
        return respondToPipelineError(c, deps, userId, subjectId, err);
      }
    }

    const parsed = PasteBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);

    const subject = await findSubjectById(deps.db, parsed.data.subjectId);
    if (!subject || subject.userId !== userId) return errorResponse(c, "not_found", "Subject not found");

    const text = parsed.data.text.slice(0, MAX_PASTE_CHARS);
    const rawUploadId = parsed.data.clientUploadId?.trim() ?? "";
    const clientUploadId = rawUploadId.length > 0 && rawUploadId.length <= 128 ? rawUploadId : null;
    const claim = await claimOrCreateMaterial(deps.db, {
      userId,
      subjectId: parsed.data.subjectId,
      kind: "paste",
      originalFilename: null,
      digestedText: text,
      status: "ready",
      clientUploadId,
    });
    if (claim.kind === "duplicate") {
      return errorResponse(c, "duplicate_material", "This material upload was already received");
    }
    return c.json(claim.material, 201);
  });

  app.get("/:id", async (c) => {
    const userId = c.get("userId");
    const material = await findMaterialById(deps.db, userId, c.req.param("id"));
    if (!material) return errorResponse(c, "not_found", "Material not found");
    return c.json(material);
  });

  return app;
}
