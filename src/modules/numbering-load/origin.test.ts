import { describe, expect, it } from "vitest";
import { parseNumberingSourceOrigin } from "@/modules/numbering-load/origin";

describe("numbering source origin", () => {
  it("keeps an http origin and drops only a trailing slash", () => {
    expect(parseNumberingSourceOrigin("  http://did-frontend:3000/  ")).toEqual({
      ok: true,
      origin: "http://did-frontend:3000",
    });
    expect(parseNumberingSourceOrigin("https://numbers.example")).toEqual({
      ok: true,
      origin: "https://numbers.example",
    });
    expect(parseNumberingSourceOrigin("   ")).toEqual({ ok: true, origin: null });
  });

  it("rejects a path, a query, a hash, and userinfo", () => {
    const secret = "super-secret-token";
    for (const value of [
      `https://numbers.example/api?token=${secret}`,
      "https://numbers.example/v1",
      "https://numbers.example/#token",
      "http://user:secret@numbers.example",
      "ftp://numbers.example",
      "not a url",
    ]) {
      const parsed = parseNumberingSourceOrigin(value);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).not.toContain(secret);
    }
    expect(parseNumberingSourceOrigin("")).not.toEqual({
      ok: true,
      origin: "https://did.finenumbers.com",
    });
  });
});
