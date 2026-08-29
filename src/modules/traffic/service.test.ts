import { describe, expect, it } from "vitest";
import { csvHeaderToCamel } from "@/modules/traffic/columns";
import {
  applyPhoneQ,
  containsInsensitive,
  facetSearchWhere,
} from "@/modules/traffic/service";

describe("containsInsensitive", () => {
  it("sets Prisma contains mode to insensitive", () => {
    expect(containsInsensitive("мтс")).toEqual({
      contains: "мтс",
      mode: "insensitive",
    });
  });
});

describe("facetSearchWhere", () => {
  it("uses insensitive contains for ordinary columns", () => {
    expect(facetSearchWhere("operatorA", "operator_a", "мтс")).toEqual({
      operatorA: { contains: "мтс", mode: "insensitive" },
    });
  });

  it("uses insensitive contains for each cdr_date needle", () => {
    const where = facetSearchWhere("cdrDate", "cdr_date", "28.12.2026");
    expect(where).toEqual({
      OR: [
        { cdrDate: { contains: "28.12.2026", mode: "insensitive" } },
        { cdrDate: { contains: "2026-12-28", mode: "insensitive" } },
      ],
    });
  });

  it("keeps duration exact-in without a case mode", () => {
    const where = facetSearchWhere("elapsedTime", "elapsed_time", "10");
    expect(where).toHaveProperty("elapsedTime.in");
    const values = (where as { elapsedTime: { in: string[] } }).elapsedTime.in;
    expect(values).toContain("10");
    expect(values).toContain("9900");
  });
});

describe("applyPhoneQ", () => {
  it("adds insensitive contains on billing and signalling numbers", () => {
    const where = applyPhoneQ({}, "Abc");
    expect(where).toEqual({
      AND: [
        {},
        {
          OR: [
            "in_ani",
            "in_dnis",
            "out_ani",
            "out_dnis",
            "bill_ani",
            "bill_dnis",
          ].map((col) => ({
            [csvHeaderToCamel(col)]: {
              contains: "Abc",
              mode: "insensitive",
            },
          })),
        },
      ],
    });
  });

  it("leaves the base where unchanged when the query is blank", () => {
    const base = { cdrId: "1" };
    expect(applyPhoneQ(base, "  ")).toBe(base);
  });
});
