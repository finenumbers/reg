import { describe, expect, it } from "vitest";
import {
  digitsFromE164,
  normalizeCostEstimateBNumber,
  secondsToElapsedMsString,
} from "@/modules/cost-estimate/normalize";

describe("cost-estimate normalize", () => {
  it("strips plus and punctuation from E.164", () => {
    expect(digitsFromE164("+7 903 123-45-67")).toBe("79031234567");
    expect(normalizeCostEstimateBNumber("+79031234567")).toBe("79031234567");
  });

  it("rejects a leading-plus number that is not admitted after strip", () => {
    expect(normalizeCostEstimateBNumber("+7495123456")).toBeNull();
  });

  it("does not convert a leading 8 to 7", () => {
    expect(normalizeCostEstimateBNumber("89031234567")).toBe("89031234567");
  });

  it("builds an elapsed ms string with BigInt", () => {
    expect(secondsToElapsedMsString(0)).toBe("0");
    expect(secondsToElapsedMsString(3)).toBe("3000");
    expect(secondsToElapsedMsString(4)).toBe("4000");
  });
});
