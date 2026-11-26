import { describe, expect, it } from "vitest";
import { abcFacetQueryHits, digitsOnly } from "@/lib/abc-facet-search";

describe("digitsOnly", () => {
  it("keeps digits from screen ABC text", () => {
    expect(digitsOnly("7 (39155)")).toBe("739155");
    expect(digitsOnly("7 (383)")).toBe("7383");
  });
});

describe("abcFacetQueryHits", () => {
  it("matches a full digit code against formatted ABC", () => {
    expect(abcFacetQueryHits("7 (39155)", "739155")).toBe(true);
    expect(abcFacetQueryHits("7 (383)", "7383")).toBe(true);
  });

  it("keeps substring hits on the screen text", () => {
    expect(abcFacetQueryHits("7 (39155)", "39155")).toBe(true);
    expect(abcFacetQueryHits("7 (39155)", "7 (")).toBe(true);
  });

  it("matches the empty label and rejects unrelated text", () => {
    expect(abcFacetQueryHits("__empty__", "пусто")).toBe(true);
    expect(abcFacetQueryHits("7 (39155)", "москва")).toBe(false);
    expect(abcFacetQueryHits("7 (39155)", "739156")).toBe(false);
  });
});
