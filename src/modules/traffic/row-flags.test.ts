import { describe, expect, it } from "vitest";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import {
  classifyTrafficListRow,
  knownEmptyDurationWhere,
  parkingKnownWhere,
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

  it("reads dp_name for parking with a known side", () => {
    expect(
      classifyTrafficListRow({
        bill_ani: "79001112233",
        bill_dnis: "79004445566",
        side_a: "Офис",
        side_b: MISSING_BILLING_LABEL,
        dp_name: "Service_Parking",
      }),
    ).toBe("parking_known");
  });

  it("reads elapsed_time for a known side with empty duration", () => {
    expect(
      classifyTrafficListRow({
        bill_ani: "79001112233",
        bill_dnis: "79004445566",
        side_a: "Офис",
        side_b: MISSING_BILLING_LABEL,
        elapsed_time: "",
      }),
    ).toBe("known_empty_duration");
    expect(
      classifyTrafficListRow({
        bill_ani: "79001112233",
        bill_dnis: "79004445566",
        side_a: "Офис",
        side_b: MISSING_BILLING_LABEL,
        elapsed_time: "0",
      }),
    ).toBeNull();
  });
});

describe("trafficFlagWhere", () => {
  it("is null when all flags are off", () => {
    expect(trafficFlagWhere({})).toBeNull();
    expect(
      trafficFlagWhere({
        phantom: false,
        callErrors: false,
        parking: false,
        noAnswer: false,
      }),
    ).toBeNull();
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

  it("filters parking with a known side and at least one number", () => {
    expect(trafficFlagWhere({ parking: true })).toEqual(parkingKnownWhere());
  });

  it("ORs classes when several flags are on", () => {
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
    expect(trafficFlagWhere({ parking: true, callErrors: true })).toEqual({
      OR: [{ billAni: "", billDnis: "" }, parkingKnownWhere()],
    });
    expect(trafficFlagWhere({ noAnswer: true })).toEqual(
      knownEmptyDurationWhere(),
    );
    expect(trafficFlagWhere({ noAnswer: true, parking: true })).toEqual({
      OR: [parkingKnownWhere(), knownEmptyDurationWhere()],
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
