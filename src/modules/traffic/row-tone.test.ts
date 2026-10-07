import { describe, expect, it } from "vitest";
import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";
import { cdrRowTone } from "@/modules/traffic/row-tone";

describe("cdrRowTone", () => {
  it("keeps phantom and call errors ahead of a failed status", () => {
    expect(cdrRowTone(CALL_CATEGORY.phantom, CALL_STATUS.failed)).toBe("phantom");
    expect(cdrRowTone(CALL_CATEGORY.errors, CALL_STATUS.failed)).toBe("call_error");
    expect(cdrRowTone(CALL_CATEGORY.errors, CALL_STATUS.parking)).toBe("call_error");
    expect(cdrRowTone(CALL_CATEGORY.errors, CALL_STATUS.success)).toBe("call_error");
  });

  it("paints parking status blue, including redirect and check", () => {
    expect(cdrRowTone(CALL_CATEGORY.outgoing, CALL_STATUS.parking)).toBe("parking");
    expect(cdrRowTone(CALL_CATEGORY.incoming, CALL_STATUS.parking)).toBe("parking");
    expect(cdrRowTone(CALL_CATEGORY.outgoing, CALL_STATUS.parking)).toBe("parking");
    expect(cdrRowTone(CALL_CATEGORY.check, CALL_STATUS.parking)).toBe("parking");
  });

  it("paints only a successful check yellow", () => {
    expect(cdrRowTone(CALL_CATEGORY.check, CALL_STATUS.success)).toBe("check");
    expect(cdrRowTone(CALL_CATEGORY.check, CALL_STATUS.failed)).toBe("failed");
  });

  it("paints only a failed status gray when the category has no color", () => {
    expect(cdrRowTone(CALL_CATEGORY.outgoing, CALL_STATUS.failed)).toBe("failed");
    expect(cdrRowTone(CALL_CATEGORY.outgoing, CALL_STATUS.failed)).toBe("failed");
    expect(cdrRowTone(CALL_CATEGORY.outgoing, CALL_STATUS.success)).toBeNull();
    expect(cdrRowTone(CALL_CATEGORY.outgoing, CALL_STATUS.success)).toBeNull();
  });
});
