import { describe, expect, it } from "vitest";
import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";
import { parseTrafficFlagParam, trafficFlagWhere } from "@/modules/traffic/row-flags";
import { applyPhoneQ } from "@/modules/traffic/service";

const callErrorsWhere = {
  callCategory: {
    in: [CALL_CATEGORY.routeError, CALL_CATEGORY.unregistered],
  },
};

const parkingWhere = {
  callCategory: {
    in: [CALL_CATEGORY.incomingParking, CALL_CATEGORY.outgoingParking],
  },
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
    expect(callErrorsWhere.callCategory.in).not.toContain(CALL_CATEGORY.error);
    expect(trafficFlagWhere({ parking: true })).toEqual(parkingWhere);
    expect(trafficFlagWhere({ failed: true })).toEqual({
      callStatus: CALL_STATUS.failed,
    });
    expect(trafficFlagWhere({ check: true })).toEqual({
      callCategory: CALL_CATEGORY.check,
    });
    expect(trafficFlagWhere({ success: true })).toEqual({
      callCategory: {
        in: [CALL_CATEGORY.incoming, CALL_CATEGORY.outgoing, CALL_CATEGORY.internal],
      },
      callStatus: CALL_STATUS.success,
    });
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
        {
          callCategory: {
            in: [CALL_CATEGORY.incoming, CALL_CATEGORY.outgoing, CALL_CATEGORY.internal],
          },
          callStatus: CALL_STATUS.success,
        },
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
