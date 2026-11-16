import { describe, expect, it } from "vitest";
import { catalogDigitPlain } from "@/modules/did-catalog/catalog-digit-text";

const E164 = "73915512345";

describe("catalog digit text", () => {
  it("shows the stored number when the tariff pair is empty", () => {
    expect(catalogDigitPlain("number", E164, "", "")).toBe(E164);
    expect(catalogDigitPlain("abc", E164, "", "")).toBe("");
  });

  it("leaves a filled tariff pair to the existing marks", () => {
    expect(catalogDigitPlain("number", E164, "7391", "5512345")).toBeNull();
    expect(catalogDigitPlain("abc", E164, "7391", "5512345")).toBeNull();
    expect(catalogDigitPlain("number", E164, "", "5512345")).toBeNull();
    expect(catalogDigitPlain("abc", E164, "7391", "")).toBeNull();
  });

  it("keeps the stored cells when there is no e164", () => {
    expect(catalogDigitPlain("number", "", "7391", "5512345")).toBe("5512345");
    expect(catalogDigitPlain("abc", "", "7391", "5512345")).toBe("7391");
  });
});
