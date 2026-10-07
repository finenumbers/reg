import { describe, expect, it } from "vitest";
import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";
import { cdrRowTone } from "@/modules/traffic/row-tone";

describe("cdrRowTone", () => {
  it("keeps a category color ahead of a failed status", () => {
    expect(cdrRowTone(CALL_CATEGORY.phantom, CALL_STATUS.failed)).toBe("phantom");
    expect(cdrRowTone(CALL_CATEGORY.routeError, CALL_STATUS.failed)).toBe("call_error");
    expect(cdrRowTone(CALL_CATEGORY.unregistered, CALL_STATUS.failed)).toBe("call_error");
    expect(cdrRowTone(CALL_CATEGORY.incomingParking, CALL_STATUS.failed)).toBe("parking");
    expect(cdrRowTone(CALL_CATEGORY.parkingLocal, CALL_STATUS.failed)).toBe("parking");
    expect(cdrRowTone(CALL_CATEGORY.parkingIntercity, CALL_STATUS.failed)).toBe(
      "parking",
    );
    expect(cdrRowTone(CALL_CATEGORY.parkingInternational, CALL_STATUS.failed)).toBe(
      "parking",
    );
    expect(cdrRowTone(CALL_CATEGORY.check, CALL_STATUS.failed)).toBe("check");
  });

  it("paints only a failed status gray when the category has no color", () => {
    expect(cdrRowTone(CALL_CATEGORY.redirect, CALL_STATUS.failed)).toBe("failed");
    expect(cdrRowTone(CALL_CATEGORY.outgoingIntercity, CALL_STATUS.failed)).toBe(
      "failed",
    );
    expect(cdrRowTone(CALL_CATEGORY.error, CALL_STATUS.failed)).toBe("failed");
    expect(cdrRowTone(CALL_CATEGORY.redirect, CALL_STATUS.success)).toBeNull();
    expect(cdrRowTone(CALL_CATEGORY.outgoingLocal, CALL_STATUS.success)).toBeNull();
    expect(cdrRowTone(CALL_CATEGORY.error, CALL_STATUS.success)).toBeNull();
  });

  it("does not treat the generic error category as a call error", () => {
    expect(cdrRowTone(CALL_CATEGORY.error, CALL_STATUS.success)).toBeNull();
    expect(cdrRowTone(CALL_CATEGORY.check, CALL_STATUS.success)).toBe("check");
  });
});
