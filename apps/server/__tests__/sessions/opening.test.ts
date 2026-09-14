import { describe, expect, it } from "vitest";
import { NEVER_DIRECT_ANSWER_CORE, SESSION_OPENING_USER_INSTRUCTION } from "@buxo/core/prompts";
import {
  buildOpeningTutorMessages,
  prependOpeningToTutorMessages,
  resolveOpeningGrounding,
} from "../../src/sessions/opening";

describe("resolveOpeningGrounding", () => {
  it("is fuentes when Fuente body text was included", () => {
    expect(resolveOpeningGrounding({ includedFuentesText: true })).toBe("fuentes");
  });

  it("is general when no Fuente body text made it into context", () => {
    expect(resolveOpeningGrounding({ includedFuentesText: false })).toBe("general");
  });
});

describe("buildOpeningTutorMessages", () => {
  it("sends the opening instruction as a user-role message, never a fabricated student answer", () => {
    const messages = buildOpeningTutorMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe(SESSION_OPENING_USER_INSTRUCTION);
    expect(messages[0]?.content).toContain(NEVER_DIRECT_ANSWER_CORE);
    expect(messages[0]?.content).not.toContain(
      "Always respond with a question that builds directly on the student's last answer.",
    );
    expect(messages[0]?.content.toLowerCase()).not.toMatch(/creo que|mi respuesta|yo pienso/);
  });
});

describe("prependOpeningToTutorMessages", () => {
  it("injects the opening as the first assistant turn before the student's reply", () => {
    const messages = prependOpeningToTutorMessages(
      "¿Qué pasa si duplicás x?",
      [],
      "se duplica y",
    );
    expect(messages).toEqual([
      { role: "assistant", content: "¿Qué pasa si duplicás x?" },
      { role: "user", content: "se duplica y" },
    ]);
  });

  it("omits a blank opening so history stays exchange-only", () => {
    const messages = prependOpeningToTutorMessages("  ", [], "hola");
    expect(messages).toEqual([{ role: "user", content: "hola" }]);
  });
});
