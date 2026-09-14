/**
 * Tests de la rúbrica mecánica del assessor-v4 (`gradeFromEvidence` en
 * packages/core/mechanical-rubric.ts) — verificados por MUTACIÓN sobre la
 * DEFINICIÓN (frontera de abajo del arquitecto + reglas 1-3 de v3 + mapeo
 * banda←entendimiento), NO sobre ítems del golden set. Cada caso usa
 * evidencia fabricada que ejemplifica UNA regla: si una regla deja de
 * aplicarse, su test cae. No hay un solo ítem real acá — afinarla contra los
 * 28 sería sobreajuste.
 */
import { describe, expect, it } from "vitest";
import { gradeFromEvidence, mechanicalEvidenceSchema, type MechanicalEvidence } from "../mechanical-rubric";

function ev(partial: Partial<MechanicalEvidence>): MechanicalEvidence {
  return {
    studentGaveReasoning: false,
    reasoningInOwnWords: false,
    bareResultOnly: false,
    agreementOnly: false,
    questionOnly: false,
    tutorSuppliedMethodEarlier: false,
    studentExecutesTutorMethod: false,
    mechanicalVerificationOnly: false,
    selfCorrected: false,
    reasoningCoherent: null,
    rationale: "caso de test fabricado",
    ...partial,
  };
}

describe("gradeFromEvidence — frontera de abajo (CORREGIDA 2ª corrida: none SOLO asentimiento/nada; weak = contenido que no alcanza)", () => {
  it("acuerdo pelado ('sí', 'ya veo') → none + guiding", () => {
    const g = gradeFromEvidence(ev({ agreementOnly: true }));
    expect(g.demonstratedUnderstanding).toBe("none");
    expect(g.recommendedBand).toBe("guiding");
  });

  it("mensaje sin ningún contenido propio → none + guiding", () => {
    const g = gradeFromEvidence(ev({}));
    expect(g.demonstratedUnderstanding).toBe("none");
    expect(g.recommendedBand).toBe("guiding");
  });

  it("pregunta con conciencia de métodos → weak + guiding (GT wq5-2-001: 'muestra conciencia de dos métodos posibles... Comprensión superficial')", () => {
    const g = gradeFromEvidence(ev({ questionOnly: true }));
    expect(g.demonstratedUnderstanding).toBe("weak");
    expect(g.recommendedBand).toBe("guiding");
  });

  it("repetir el fraseo del tutor (razón pero NO palabras propias) → weak + guiding (hay contenido, mal atribuido)", () => {
    const g = gradeFromEvidence(ev({ studentGaveReasoning: true, reasoningInOwnWords: false, reasoningCoherent: true }));
    expect(g.demonstratedUnderstanding).toBe("weak");
    expect(g.recommendedBand).toBe("guiding");
  });

  it("respuesta pelada (intento propio sin justificar) → weak + guiding", () => {
    const g = gradeFromEvidence(ev({ bareResultOnly: true }));
    expect(g.demonstratedUnderstanding).toBe("weak");
    expect(g.recommendedBand).toBe("guiding");
  });

  it("razonamiento propio pero incorrecto → weak + guiding", () => {
    const g = gradeFromEvidence(ev({ studentGaveReasoning: true, reasoningInOwnWords: true, reasoningCoherent: false }));
    expect(g.demonstratedUnderstanding).toBe("weak");
    expect(g.recommendedBand).toBe("guiding");
  });
});

describe("gradeFromEvidence — medio y alto de la escala", () => {
  it("FIX 1: razonamiento propio y coherente, SIN autocorrección → solid + minimal (autocorrección no es condición necesaria)", () => {
    const g = gradeFromEvidence(ev({ studentGaveReasoning: true, reasoningInOwnWords: true, reasoningCoherent: true }));
    expect(g.demonstratedUnderstanding).toBe("solid");
    expect(g.recommendedBand).toBe("minimal");
  });

  it("razonamiento propio + autocorrección → solid + minimal (la autocorrección corrobora, no gatea)", () => {
    const g = gradeFromEvidence(
      ev({ studentGaveReasoning: true, reasoningInOwnWords: true, reasoningCoherent: true, selfCorrected: true }),
    );
    expect(g.demonstratedUnderstanding).toBe("solid");
    expect(g.recommendedBand).toBe("minimal");
  });

  it("razonamiento propio con coherencia no juzgable (null) → developing (conservador: ni weak ni solid sin evidencia)", () => {
    const g = gradeFromEvidence(ev({ studentGaveReasoning: true, reasoningInOwnWords: true, reasoningCoherent: null }));
    expect(g.demonstratedUnderstanding).toBe("developing");
  });
});

describe("gradeFromEvidence — reglas mecánicas de v3 como código", () => {
  it("verificación mecánica (sustituir porque pidieron verificar) tapa en developing aunque todo sea correcto", () => {
    const g = gradeFromEvidence(
      ev({ studentGaveReasoning: true, reasoningInOwnWords: true, reasoningCoherent: true, selfCorrected: true, mechanicalVerificationOnly: true }),
    );
    expect(g.demonstratedUnderstanding).toBe("developing");
    expect(g.recommendedBand).toBe("probing");
  });

  it("techo tutor-led: el tutor dio el método y el estudiante lo ejecuta → developing+probing, AUN con autocorrección", () => {
    const g = gradeFromEvidence(
      ev({
        studentGaveReasoning: true,
        reasoningInOwnWords: true,
        reasoningCoherent: true,
        selfCorrected: true,
        tutorSuppliedMethodEarlier: true,
        studentExecutesTutorMethod: true,
      }),
    );
    expect(g.demonstratedUnderstanding).toBe("developing");
    expect(g.recommendedBand).toBe("probing");
  });

  it("techo tutor-led NO aplica si el tutor no dio el método (sin techo falso)", () => {
    const g = gradeFromEvidence(
      ev({ studentGaveReasoning: true, reasoningInOwnWords: true, reasoningCoherent: true, selfCorrected: true, tutorSuppliedMethodEarlier: false }),
    );
    expect(g.demonstratedUnderstanding).toBe("solid");
  });
});

describe("mechanicalEvidenceSchema — el modelo devuelve solo la evidencia (shape correcto)", () => {
  it("parsea un objeto de evidencia válido", () => {
    expect(mechanicalEvidenceSchema.safeParse(ev({ studentGaveReasoning: true, reasoningInOwnWords: true, reasoningCoherent: true })).success).toBe(true);
  });

  it("rechaza un objeto sin los campos (el modelo no puede omitir evidencia)", () => {
    expect(mechanicalEvidenceSchema.safeParse({ studentGaveReasoning: true }).success).toBe(false);
  });
});
