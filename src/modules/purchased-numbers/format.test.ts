import { describe, expect, it } from "vitest";
import {
  displayPurchasedNumberCell,
  displayPurchasedNumberFacet,
} from "@/modules/purchased-numbers/format";

describe("purchased-number display", () => {
  it("groups a whole amount and leaves a client name as stored", () => {
    expect(displayPurchasedNumberCell("purchase", "200000")).toBe("200 000");
    expect(displayPurchasedNumberCell("premium", "1500.5")).toBe("1 500.5");
    expect(displayPurchasedNumberCell("premium", "золотой")).toBe("золотой");
    expect(displayPurchasedNumberCell("client", "1000")).toBe("1000");
    expect(displayPurchasedNumberCell("number", "0495")).toBe("0495");
  });

  it("labels empty cells and shows the stored amount in a menu", () => {
    expect(displayPurchasedNumberFacet("city", "")).toBe("(пусто)");
    expect(displayPurchasedNumberFacet("city", "__empty__")).toBe("(пусто)");
    expect(displayPurchasedNumberFacet("purchase", "200000")).toBe("200 000");
    expect(displayPurchasedNumberFacet("premium", "1500.5")).toBe("1 500.5");
    expect(displayPurchasedNumberFacet("client", "1000")).toBe("1000");
    expect(displayPurchasedNumberFacet("provider", "aurora")).toBe("aurora");
  });
});
