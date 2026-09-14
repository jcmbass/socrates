import { describe, expect, it } from "vitest";

import {
  activeSeedKeys,
  addCustomSubject,
  existingSubjectSelections,
  initialSubjectSelections,
  removeSelection,
  seedLevelForGradeLevelId,
  seedSubjectSelections,
  selectedCount,
  selectedCustomNames,
  selectedSeedKeys,
  toggleSelection,
} from "../onboardCatalog";
import type { SeedSubjectOption } from "../api/types";

function seedOption(overrides: Partial<SeedSubjectOption> = {}): SeedSubjectOption {
  return {
    level: "bachillerato",
    subjectKey: "matematica",
    name: { es: "Matemática", en: "Mathematics" },
    unitCount: { es: 4, en: 4 },
    topicCount: { es: 12, en: 12 },
    ...overrides,
  };
}

describe("seedLevelForGradeLevelId", () => {
  it("resolves bachillerato grade levels to 'bachillerato'", () => {
    expect(seedLevelForGradeLevelId("sv-bachillerato-1")).toBe("bachillerato");
    expect(seedLevelForGradeLevelId("sv-bachillerato-3")).toBe("bachillerato");
  });

  it("resolves universidad ciclos to 'universidad' — the R-2 bug this phase fixes (universidad used to render empty)", () => {
    expect(seedLevelForGradeLevelId("sv-universidad-1")).toBe("universidad");
    expect(seedLevelForGradeLevelId("sv-universidad-10")).toBe("universidad");
  });

  it("is null for básica (disabled, DF-P01) and for an unknown id", () => {
    expect(seedLevelForGradeLevelId("sv-basica-1")).toBeNull();
    expect(seedLevelForGradeLevelId("not-a-real-id")).toBeNull();
  });
});

describe("existingSubjectSelections / seedSubjectSelections / activeSeedKeys", () => {
  it("existing subjects come pre-selected, source 'existing'", () => {
    const selections = existingSubjectSelections([{ id: "s1", name: "Robótica", seedCatalogKey: null }]);
    expect(selections).toEqual([{ id: "s1", name: "Robótica", source: "existing", selected: true }]);
  });

  it("seed subjects resolve the display name for the given locale and are pre-selected", () => {
    const selections = seedSubjectSelections([seedOption()], "en");
    expect(selections).toEqual([{ id: "seed-matematica", name: "Mathematics", source: "seed", selected: true, seedKey: "matematica" }]);
  });

  it("activeSeedKeys extracts subjectKey from full seedCatalogKey (level/subjectKey) and skips nulls", () => {
    expect(
      activeSeedKeys([
        { id: "s1", name: "Matemáticas", seedCatalogKey: "bachillerato/matematicas" },
        { id: "s2", name: "Robótica", seedCatalogKey: null },
        { id: "s3", name: "Física", seedCatalogKey: "universidad/fisica" },
      ]),
    ).toEqual(["matematicas", "fisica"]);
  });

  it("activeSeedKeys tolerates a bare subjectKey (no slash) without inventing a level", () => {
    expect(activeSeedKeys([{ id: "s1", name: "Física", seedCatalogKey: "fisica" }])).toEqual(["fisica"]);
  });

  it("seedSubjectSelections excludes keys already active — an activated seed subject shows once, as existing", () => {
    const selections = seedSubjectSelections(
      [seedOption({ subjectKey: "matematicas" }), seedOption({ subjectKey: "fisica", name: { es: "Física", en: "Physics" } })],
      "es",
      ["matematicas"],
    );
    expect(selections).toEqual([{ id: "seed-fisica", name: "Física", source: "seed", selected: true, seedKey: "fisica" }]);
  });
});

describe("initialSubjectSelections", () => {
  it("combines existing subjects with not-yet-active seed suggestions (real seedCatalogKey shape from C2-a)", () => {
    const existing = [{ id: "s1", name: "Matemáticas", seedCatalogKey: "bachillerato/matematicas" }];
    const seed = [
      seedOption({ subjectKey: "matematicas", name: { es: "Matemáticas", en: "Mathematics" } }),
      seedOption({ subjectKey: "fisica", name: { es: "Física", en: "Physics" } }),
    ];
    const selections = initialSubjectSelections(existing, seed, "es");
    expect(selections.map((s) => s.id)).toEqual(["s1", "seed-fisica"]);
    expect(selections.every((s) => s.selected)).toBe(true);
  });

  it("does not double-list when every seed subject is already active (C4 paso-2 regression)", () => {
    const existing = [
      { id: "s1", name: "Matemáticas", seedCatalogKey: "bachillerato/matematicas" },
      { id: "s2", name: "Física", seedCatalogKey: "bachillerato/fisica" },
    ];
    const seed = [
      seedOption({ subjectKey: "matematicas", name: { es: "Matemáticas", en: "Mathematics" } }),
      seedOption({ subjectKey: "fisica", name: { es: "Física", en: "Physics" } }),
    ];
    const selections = initialSubjectSelections(existing, seed, "es");
    expect(selections).toHaveLength(2);
    expect(selections.every((s) => s.source === "existing")).toBe(true);
    expect(selectedCount(selections)).toBe(2);
  });

  it("is just the seed suggestions when the student has no existing subjects yet", () => {
    const selections = initialSubjectSelections([], [seedOption()], "es");
    expect(selections).toHaveLength(1);
    expect(selections[0]!.source).toBe("seed");
  });
});

describe("toggleSelection", () => {
  it("flips only the matching selection", () => {
    const initial = seedSubjectSelections([seedOption({ subjectKey: "a" }), seedOption({ subjectKey: "b" })], "es");
    const target = initial[0]!;
    const next = toggleSelection(initial, target.id);
    expect(next.find((s) => s.id === target.id)?.selected).toBe(false);
    expect(next.filter((s) => s.id !== target.id).every((s) => s.selected)).toBe(true);

    const backOn = toggleSelection(next, target.id);
    expect(backOn.find((s) => s.id === target.id)?.selected).toBe(true);
  });
});

describe("addCustomSubject / removeSelection", () => {
  it("adds a trimmed, pre-selected custom subject with a unique id", () => {
    const withCustom = addCustomSubject([], "  Robótica  ");
    expect(withCustom).toHaveLength(1);
    expect(withCustom[0]).toMatchObject({ name: "Robótica", source: "custom", selected: true });
  });

  it("is a no-op for a blank name", () => {
    expect(addCustomSubject([], "   ")).toEqual([]);
  });

  it("removeSelection drops the row entirely (not just unselects)", () => {
    const withCustom = addCustomSubject([], "Robótica");
    const id = withCustom[0]!.id;
    expect(removeSelection(withCustom, id)).toEqual([]);
  });

  it("two custom subjects added in sequence get distinct ids", () => {
    const one = addCustomSubject([], "Robótica");
    const two = addCustomSubject(one, "Ajedrez");
    expect(two[0]!.id).not.toBe(two[1]!.id);
  });
});

describe("selectedCount / selectedSeedKeys / selectedCustomNames", () => {
  it("counts every selected row regardless of source", () => {
    let selections = initialSubjectSelections([{ id: "s1", name: "Robótica", seedCatalogKey: null }], [seedOption()], "es");
    selections = addCustomSubject(selections, "Ajedrez");
    expect(selectedCount(selections)).toBe(3);
  });

  it("selectedSeedKeys returns only selected seed rows' keys, ignoring existing/custom", () => {
    let selections = initialSubjectSelections(
      [{ id: "s1", name: "Robótica", seedCatalogKey: null }],
      [seedOption({ subjectKey: "matematica" }), seedOption({ subjectKey: "fisica", name: { es: "Física", en: "Física" } })],
      "es",
    );
    selections = toggleSelection(selections, "seed-fisica");
    expect(selectedSeedKeys(selections)).toEqual(["matematica"]);
  });

  it("selectedCustomNames returns only selected custom rows' names, ignoring existing/seed", () => {
    let selections = initialSubjectSelections([{ id: "s1", name: "Robótica", seedCatalogKey: null }], [seedOption()], "es");
    selections = addCustomSubject(selections, "Ajedrez");
    expect(selectedCustomNames(selections)).toEqual(["Ajedrez"]);
  });
});
