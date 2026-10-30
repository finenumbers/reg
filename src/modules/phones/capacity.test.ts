import { describe, expect, it } from "vitest";
import { displayTermCapacity } from "@/modules/phones/capacity";

describe("displayTermCapacity", () => {
  it("writes Премиум only when the catalog value is blank", () => {
    expect(displayTermCapacity(null)).toBe("Премиум");
    expect(displayTermCapacity(undefined)).toBe("Премиум");
    expect(displayTermCapacity("")).toBe("Премиум");
    expect(displayTermCapacity("   ")).toBe("Премиум");
    expect(displayTermCapacity("0")).toBe("0");
    expect(displayTermCapacity(" 10 ")).toBe(" 10 ");
  });
});
