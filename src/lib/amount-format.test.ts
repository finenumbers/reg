import { describe, expect, it } from "vitest";
import {
  amountFacetQueryHits,
  formatAmountCell,
  formatStoredAmount,
} from "@/lib/amount-format";

describe("formatAmountCell", () => {
  it("groups a whole number and keeps a fraction", () => {
    expect(formatAmountCell("200000")).toBe("200 000");
    expect(formatAmountCell("200 000")).toBe("200 000");
    expect(formatAmountCell("1500000")).toBe("1 500 000");
    expect(formatAmountCell("10")).toBe("10");
    expect(formatAmountCell("10.5")).toBe("10.5");
    expect(formatAmountCell("10,50")).toBe("10,50");
    expect(formatAmountCell("-1500")).toBe("-1 500");
    expect(formatAmountCell("")).toBe("");
    expect(formatAmountCell("   ")).toBe("");
  });

  it("leaves text that is not one number", () => {
    expect(formatAmountCell("премиум")).toBe("премиум");
    expect(formatAmountCell("=покупка")).toBe("=покупка");
    expect(formatAmountCell("1.500.000")).toBe("1.500.000");
  });

  it("labels an empty facet and finds a spaced query", () => {
    expect(formatStoredAmount("")).toBe("(пусто)");
    expect(formatStoredAmount("__empty__")).toBe("(пусто)");
    expect(formatStoredAmount("200000")).toBe("200 000");
    expect(amountFacetQueryHits("200000", "200 000")).toBe(true);
    expect(amountFacetQueryHits("200000", "200000")).toBe(true);
    expect(amountFacetQueryHits("1 500 000", "1500")).toBe(true);
    expect(amountFacetQueryHits("премиум", "пре")).toBe(true);
    expect(amountFacetQueryHits("__empty__", "пусто")).toBe(true);
    expect(amountFacetQueryHits("__empty__", "empty")).toBe(false);
    expect(amountFacetQueryHits("200000", "пре")).toBe(false);
  });
});
