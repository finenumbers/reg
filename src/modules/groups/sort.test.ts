import { describe, expect, it } from "vitest";
import {
  compareRoutingGroupIds,
  sortRoutingGroupsById,
} from "@/modules/groups/sort";

describe("sortRoutingGroupsById", () => {
  it("orders IDs numerically ascending", () => {
    expect(
      sortRoutingGroupsById([
        { externalId: "10", name: "b" },
        { externalId: "2", name: "a" },
        { externalId: "100", name: "c" },
      ]).map((r) => r.externalId),
    ).toEqual(["2", "10", "100"]);
  });

  it("compareRoutingGroupIds is ascending", () => {
    expect(compareRoutingGroupIds("9", "10")).toBeLessThan(0);
    expect(compareRoutingGroupIds("10", "9")).toBeGreaterThan(0);
  });
});
