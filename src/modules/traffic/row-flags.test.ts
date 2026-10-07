import { describe, expect, it } from "vitest";
import {
  CALL_CATEGORY,
  CALL_STATUS,
  SUCCESS_CALL_TYPES,
} from "@/modules/traffic/call-class";
import { parseTrafficFlagParam, trafficFlagWhere } from "@/modules/traffic/row-flags";
import { applyPhoneQ } from "@/modules/traffic/service";

const callErrorsWhere = {
  callCategory: CALL_CATEGORY.errors,
};

const parkingWhere = {
  callStatus: CALL_STATUS.parking,
};

const successWhere = {
  callStatus: CALL_STATUS.success,
  OR: [
    { callCategory: CALL_CATEGORY.incoming },
    {
      callCategory: CALL_CATEGORY.outgoing,
      callType: { in: [...SUCCESS_CALL_TYPES] },
    },
  ],
};

describe("parseTrafficFlagParam", () => {
  it("accepts 1 and true", () => {
    expect(parseTrafficFlagParam("1")).toBe(true);
    expect(parseTrafficFlagParam("true")).toBe(true);
    expect(parseTrafficFlagParam("0")).toBe(false);
    expect(parseTrafficFlagParam(null)).toBe(false);
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
        failed: false,
        check: false,
        success: false,
      }),
    ).toBeNull();
  });

  it("filters stored category and status", () => {
    expect(trafficFlagWhere({ phantom: true })).toEqual({
      callCategory: CALL_CATEGORY.phantom,
    });
    expect(trafficFlagWhere({ callErrors: true })).toEqual(callErrorsWhere);
    expect(trafficFlagWhere({ parking: true })).toEqual(parkingWhere);
    expect(trafficFlagWhere({ failed: true })).toEqual({
      callStatus: CALL_STATUS.failed,
    });
    expect(trafficFlagWhere({ check: true })).toEqual({
      callCategory: CALL_CATEGORY.check,
    });
    expect(trafficFlagWhere({ success: true })).toEqual(successWhere);
  });

  it("ORs classes when several flags are on", () => {
    expect(trafficFlagWhere({ phantom: true, callErrors: true })).toEqual({
      OR: [{ callCategory: CALL_CATEGORY.phantom }, callErrorsWhere],
    });
    expect(trafficFlagWhere({ parking: true, failed: true })).toEqual({
      OR: [parkingWhere, { callStatus: CALL_STATUS.failed }],
    });
    expect(trafficFlagWhere({ success: true, failed: true })).toEqual({
      OR: [
        { callStatus: CALL_STATUS.failed },
        successWhere,
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
