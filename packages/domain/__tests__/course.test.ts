import { describe, expect, it } from "vitest";
import { CourseSchema, type Course } from "../course";

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: "course-1",
    userId: "user-1",
    gradeLevelId: "sv-bachillerato-1",
    customLabel: null,
    academicYear: 2026,
    status: "active",
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

describe("CourseSchema", () => {
  it("accepts a well-formed active Course", () => {
    expect(CourseSchema.safeParse(makeCourse()).success).toBe(true);
  });

  it("accepts a null academicYear (e.g. continuous universidad)", () => {
    expect(CourseSchema.safeParse(makeCourse({ academicYear: null })).success).toBe(true);
  });

  it("accepts a custom label override", () => {
    expect(CourseSchema.safeParse(makeCourse({ customLabel: "Mi curso" })).success).toBe(true);
  });

  it("rejects an invalid status", () => {
    expect(CourseSchema.safeParse(makeCourse({ status: "deleted" as never })).success).toBe(false);
  });
});
