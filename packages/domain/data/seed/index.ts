/**
 * Seed catalog data — the 10 `<nivel>/<materia>.json` files copied
 * byte-identically from `buxo-seed/catalog/**` (D-C05). This module is
 * DATA, not logic — it is validated structurally against
 * `SeedCatalogSchema` in `__tests__/seed-catalog.test.ts`, not here (same
 * split as `data/el-salvador.ts` vs `education-catalog.ts`).
 *
 * Imported as JSON modules (`resolveJsonModule`), never read from disk with
 * `fs` — this package stays Node-built-in-free.
 */
import type { SeedCatalog } from "../../seed-catalog";

import bachilleratoBiologia from "./bachillerato/biologia.json";
import bachilleratoEconomia from "./bachillerato/economia.json";
import bachilleratoFisica from "./bachillerato/fisica.json";
import bachilleratoMatematicas from "./bachillerato/matematicas.json";
import bachilleratoQuimica from "./bachillerato/quimica.json";
import universidadBiologia from "./universidad/biologia.json";
import universidadEconomia from "./universidad/economia.json";
import universidadFisica from "./universidad/fisica.json";
import universidadMatematicas from "./universidad/matematicas.json";
import universidadQuimica from "./universidad/quimica.json";

export const SEED_CATALOGS: readonly SeedCatalog[] = [
  bachilleratoBiologia,
  bachilleratoEconomia,
  bachilleratoFisica,
  bachilleratoMatematicas,
  bachilleratoQuimica,
  universidadBiologia,
  universidadEconomia,
  universidadFisica,
  universidadMatematicas,
  universidadQuimica,
] as SeedCatalog[];
