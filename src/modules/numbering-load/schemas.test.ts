import { describe, expect, it } from "vitest";
import {
  freeSourceWrite,
  numberingLoadAuditMeta,
  numberingSourceSaveSchema,
  purchasedSourceWrite,
} from "@/modules/numbering-load/schemas";

const SECRET = "super-secret-token";

describe("numbering source save", () => {
  it("writes one source and leaves the other columns alone", () => {
    expect(freeSourceWrite("https://free.example", null)).toEqual({
      freeNumbersSourceBaseUrl: "https://free.example",
    });
    expect(freeSourceWrite("https://free.example", "v1:cipher")).toEqual({
      freeNumbersSourceBaseUrl: "https://free.example",
      freeNumbersSourceTokenCiphertext: "v1:cipher",
    });
    const purchased = purchasedSourceWrite(null, null);
    expect(purchased).toEqual({ purchasedNumbersSourceBaseUrl: null });
    expect(purchased).not.toHaveProperty("freeNumbersSourceBaseUrl");
    expect(purchased).not.toHaveProperty("freeNumbersSourceTokenCiphertext");
  });

  it("keeps the token out of the audit meta and the schema error", () => {
    const meta = numberingLoadAuditMeta("https://free.example", true);
    expect(Object.keys(meta).sort()).toEqual(["baseUrl", "tokenReplaced"]);
    expect(JSON.stringify(meta)).not.toContain(SECRET);
    expect(JSON.stringify(meta)).not.toContain("hasToken");

    const parsed = numberingSourceSaveSchema.safeParse({
      baseUrl: "https://free.example",
      token: SECRET,
      source: "free",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).not.toContain(SECRET);
    }
  });

  it("accepts an empty token field", () => {
    expect(
      numberingSourceSaveSchema.parse({ baseUrl: "", token: "" }),
    ).toEqual({ baseUrl: "", token: "" });
  });
});
