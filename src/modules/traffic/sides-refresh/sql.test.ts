import { describe, expect, it } from "vitest";
import { buildSidesUpdateSql } from "@/modules/traffic/sides-refresh/sql";

describe("buildSidesUpdateSql", () => {
  it("parameterizes phone and description for both sides", () => {
    const pairs = [{ phone: "73915190530", description: "Сафетель; drop" }];
    const sideA = buildSidesUpdateSql("a", pairs);
    const sideB = buildSidesUpdateSql("b", pairs);
    expect(sideA.values).toContain("73915190530");
    expect(sideA.values).toContain("Сафетель; drop");
    expect(sideA.strings.join(" ")).toMatch(/bill_ani/);
    expect(sideA.strings.join(" ")).toMatch(/side_a/);
    expect(sideB.strings.join(" ")).toMatch(/bill_dnis/);
    expect(sideB.strings.join(" ")).toMatch(/side_b/);
  });

  it("rejects an empty pair list", () => {
    expect(() => buildSidesUpdateSql("a", [])).toThrow(/at least one pair/);
  });
});
