import { describe, expect, it } from "vitest";

import { buildOnboardSummary } from "../onboardSummary";

describe("buildOnboardSummary", () => {
  it("sums subject count and topic counts", () => {
    expect(buildOnboardSummary([{ topicCount: 12 }, { topicCount: 8 }, { topicCount: 0 }])).toEqual({
      subjectCount: 3,
      topicCount: 20,
    });
  });

  it("treats a missing topicCount as 0 (custom subjects created with an empty temario)", () => {
    expect(buildOnboardSummary([{ topicCount: 5 }, {}])).toEqual({ subjectCount: 2, topicCount: 5 });
  });

  it("is zero for an empty list", () => {
    expect(buildOnboardSummary([])).toEqual({ subjectCount: 0, topicCount: 0 });
  });
});
