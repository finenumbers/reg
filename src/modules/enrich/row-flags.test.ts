import { describe, expect, it } from "vitest";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import { isSideKnown } from "@/modules/enrich/row-flags";

describe("isSideKnown", () => {
  it("rejects empty and billing-miss labels", () => {
    expect(isSideKnown("")).toBe(false);
    expect(isSideKnown(MISSING_BILLING_LABEL)).toBe(false);
    expect(isSideKnown("Офис")).toBe(true);
  });
});
