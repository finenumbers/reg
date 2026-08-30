import { describe, expect, it } from "vitest";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import {
  classifyTrafficListRow,
  parseTrafficFlagParam,
  trafficFlagWhere,
} from "@/modules/traffic/row-flags";
import { applyPhoneQ } from "@/modules/traffic/service";

describe("parseTrafficFlagParam", () => {
  it("accepts 1 and true", () => {
    expect(parseTrafficFlagParam("1")).toBe(true);
    expect(parseTrafficFlagParam("true")).toBe(true);
    expect(parseTrafficFlagParam("0")).toBe(false);
    expect(parseTrafficFlagParam(null)).toBe(false);
  });
});

describe("classifyTrafficListRow", () => {
  it("reads snake_case list fields", () => {
    expect(
      classifyTrafficListRow({
        bill_ani: "",
        bill_dnis: "",
        side_a: MISSING_BILLING_LABEL,
        side_b: MISSING_BILLING_LABEL,
      }),
    ).toBe("call_error");
  });
});

describe("trafficFlagWhere", () => {
  it("is null when both flags are off", () => {
    expect(trafficFlagWhere({})).toBeNull();
    expect(trafficFlagWhere({ phantom: false, callErrors: false })).toBeNull();
  });

  it("filters empty billing numbers for call errors", () => {
    expect(trafficFlagWhere({ callErrors: true })).toEqual({
      billAni: "",
      billDnis: "",
    });
  });

  it("filters filled numbers with both billing misses for phantom", () => {
    expect(trafficFlagWhere({ phantom: true })).toEqual({
      billAni: { not: "" },
      billDnis: { not: "" },
      sideA: MISSING_BILLING_LABEL,
      sideB: MISSING_BILLING_LABEL,
    });
  });

  it("ORs both classes when both flags are on", () => {
    expect(trafficFlagWhere({ phantom: true, callErrors: true })).toEqual({
      OR: [
        {
          billAni: { not: "" },
          billDnis: { not: "" },
          sideA: MISSING_BILLING_LABEL,
          sideB: MISSING_BILLING_LABEL,
        },
        { billAni: "", billDnis: "" },
      ],
    });
  });

  it("ANDs the flag predicate with phone search", () => {
    const flags = trafficFlagWhere({ callErrors: true })!;
    const where = applyPhoneQ(flags, "7900");
    expect(where).toMatchObject({
      AND: [flags, { OR: expect.any(Array) }],
    });
  });
});
