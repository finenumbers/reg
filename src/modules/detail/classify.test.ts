import { describe, expect, it } from "vitest";
import {
  hasOutgoingSlice,
  isParkingDst,
  isPstnLdc,
  isPstnLocal,
  isTrunkDst,
  PARKING_DST,
} from "@/modules/detail/classify";

describe("isPstnLocal", () => {
  it("matches PSTN_ names that end with _Local", () => {
    expect(isPstnLocal("PSTN_Sochi_MTS_Local")).toBe(true);
  });

  it("rejects unsuffixed PSTN, LDC, OLD, and case variants", () => {
    expect(isPstnLocal("PSTN_Sochi_MTS")).toBe(false);
    expect(isPstnLocal("PSTN_Sochi_MTS_LDC")).toBe(false);
    expect(isPstnLocal("PSTN_Sochi_MTS_OLD")).toBe(false);
    expect(isPstnLocal("pstn_Sochi_MTS_Local")).toBe(false);
    expect(isPstnLocal("Trunk_MSK_Local")).toBe(false);
  });
});

describe("isPstnLdc", () => {
  it("matches _LDC on PSTN_", () => {
    expect(isPstnLdc("PSTN_Sochi_MTS_LDC")).toBe(true);
  });

  it("rejects OLD, Local, unsuffixed, and Trunk", () => {
    expect(isPstnLdc("PSTN_Sochi_MTS_OLD")).toBe(false);
    expect(isPstnLdc("PSTN_Sochi_MTS_Local")).toBe(false);
    expect(isPstnLdc("PSTN_Sochi_MTS")).toBe(false);
    expect(isPstnLdc("Trunk_MSK_LDC")).toBe(false);
  });
});

describe("isTrunkDst / isParkingDst / hasOutgoingSlice", () => {
  it("matches Trunk_ regardless of suffix", () => {
    expect(isTrunkDst("Trunk_MSK")).toBe(true);
    expect(isTrunkDst("Trunk_Sochi_Local")).toBe(true);
    expect(isTrunkDst("PSTN_A")).toBe(false);
  });

  it("matches exact Service_Parking", () => {
    expect(isParkingDst(PARKING_DST)).toBe(true);
    expect(isParkingDst("Service_Parking_1")).toBe(false);
  });

  it("outgoing slice is Local, Trunk, or LDC only", () => {
    expect(hasOutgoingSlice("PSTN_A_Local")).toBe(true);
    expect(hasOutgoingSlice("Trunk_MSK")).toBe(true);
    expect(hasOutgoingSlice("PSTN_A_LDC")).toBe(true);
    expect(hasOutgoingSlice("PSTN_A_OLD")).toBe(false);
    expect(hasOutgoingSlice("PSTN_A")).toBe(false);
    expect(hasOutgoingSlice(PARKING_DST)).toBe(false);
  });
});
