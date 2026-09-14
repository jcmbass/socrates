/**
 * Regression: uploads died on-device because RN's FormData spreads each
 * part and `expo-file-system`'s `File` keeps `uri` on the prototype.
 * See `lib/api/formDataPart.ts` for the full story.
 */
import { describe, expect, it } from "vitest";
import { pdfFormPart } from "../api/formDataPart";

/** Exactly what RN's `FormData.getParts()` does to every non-string value. */
function rnGetPart(value: object, fieldName: string): Record<string, unknown> {
  return { ...value, headers: { "content-disposition": `form-data; name="${fieldName}"` }, fieldName };
}

describe("pdfFormPart — survives RN's own-property spread", () => {
  it("keeps uri/name/type after the spread RN performs", () => {
    const part = rnGetPart(pdfFormPart("file:///cache/ingest-1.pdf", "guia.pdf"), "page1");
    expect(part.uri).toBe("file:///cache/ingest-1.pdf");
    expect(part.name).toBe("guia.pdf");
    expect(part.type).toBe("application/pdf");
    expect(part.fieldName).toBe("page1");
  });

  it("documents the failure mode: a class with prototype getters loses everything", () => {
    // Stand-in for expo-file-system's native `File` — uri/name are getters
    // on the prototype, so they are NOT own enumerable properties.
    class FakeExpoFile {
      constructor(private readonly path: string) {}
      get uri(): string {
        return this.path;
      }
      get name(): string {
        return "guia.pdf";
      }
    }
    const broken = rnGetPart(new FakeExpoFile("file:///cache/ingest-1.pdf"), "page1");
    expect(broken.uri).toBeUndefined();
    expect(broken.name).toBeUndefined();
  });

  it("every field is an own enumerable property", () => {
    const part = pdfFormPart("file:///x.pdf", "x.pdf");
    expect(Object.keys(part).sort()).toEqual(["name", "type", "uri"]);
  });
});
