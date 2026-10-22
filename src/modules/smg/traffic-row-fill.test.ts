import { describe, expect, it } from "vitest";
import { AF_CATEGORY } from "@/modules/smg-trace/classify";
import { smgTrafficRowFill } from "@/modules/smg/traffic-row-fill";

describe("smgTrafficRowFill", () => {
  it("paints Parking delay gray before a blocked category", () => {
    expect(smgTrafficRowFill(AF_CATEGORY.blocked, "55")).toBe("parking");
    expect(smgTrafficRowFill(AF_CATEGORY.passed, "0")).toBe("parking");
    expect(smgTrafficRowFill(AF_CATEGORY.blocked, "55, 7")).toBe("parking");
    expect(smgTrafficRowFill(AF_CATEGORY.rejectIgnored, " 12 ")).toBe("parking");
  });

  it("paints a blocked call red only when Parking has no delay", () => {
    expect(smgTrafficRowFill(AF_CATEGORY.blocked, "")).toBe("blocked");
    expect(smgTrafficRowFill(AF_CATEGORY.blocked, "   ")).toBe("blocked");
    expect(smgTrafficRowFill(AF_CATEGORY.blocked, null)).toBe("blocked");
  });

  it("leaves other categories plain when Parking is empty", () => {
    expect(smgTrafficRowFill(AF_CATEGORY.passed, "")).toBeNull();
    expect(smgTrafficRowFill(AF_CATEGORY.noData, "")).toBeNull();
    expect(smgTrafficRowFill("Нет АнтиФрода", "")).toBeNull();
  });
});
