import { describe, expect, it } from "vitest";
import {
  displayFreeNumberCell,
  displayFreeNumberFacet,
} from "@/modules/free-numbers/format";

describe("free-number display", () => {
  it("groups a whole amount and keeps a fraction", () => {
    expect(displayFreeNumberCell("incomingPurchase", "200000")).toBe("200 000");
    expect(displayFreeNumberCell("incomingPeriod", "1500.5")).toBe("1 500.5");
    expect(displayFreeNumberCell("purchase", "200000")).toBe("200 000");
    expect(displayFreeNumberCell("premium", "1500.5")).toBe("1 500.5");
    expect(displayFreeNumberCell("premium", "золотой")).toBe("золотой");
    expect(displayFreeNumberCell("number", "0495")).toBe("0495");
  });

  it("labels empty cells and shows the stored amount in a menu", () => {
    expect(displayFreeNumberFacet("city", "")).toBe("(пусто)");
    expect(displayFreeNumberFacet("city", "__empty__")).toBe("(пусто)");
    expect(displayFreeNumberFacet("incomingPurchase", "200000")).toBe("200 000");
    expect(displayFreeNumberFacet("premium", "1500.5")).toBe("1 500.5");
    expect(displayFreeNumberFacet("provider", "didww")).toBe("didww");
  });
});
