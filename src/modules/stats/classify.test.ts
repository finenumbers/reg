import { describe, expect, it } from "vitest";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import {
  classifyCallLegs,
  classifyDevice,
  classifySipTrunk,
  isIncomingParking,
  isParkingPhantom,
  isPlatform,
  isSipTrunk,
  PARKING_DST,
} from "@/modules/stats/classify";

describe("isSipTrunk / isPlatform", () => {
  it("matches exact prefixes", () => {
    expect(isSipTrunk("PSTN_Sochi_MTS_Local")).toBe(true);
    expect(isSipTrunk("Trunk_MSK")).toBe(true);
    expect(isPlatform("Service_IVR")).toBe(true);
    expect(isPlatform("Platform_Core")).toBe(true);
  });

  it("is case-sensitive and requires the underscore", () => {
    expect(isSipTrunk("pstn_Sochi")).toBe(false);
    expect(isSipTrunk("PSTNxSochi")).toBe(false);
    expect(isSipTrunk("TrunkX")).toBe(false);
    expect(isPlatform("service_IVR")).toBe(false);
    expect(isPlatform("PlatformX")).toBe(false);
  });

  it("does not treat the other category as a match", () => {
    expect(isSipTrunk("Service_IVR")).toBe(false);
    expect(isPlatform("PSTN_A")).toBe(false);
    expect(classifyDevice("Phone_101")).toBeNull();
  });
});

describe("classifySipTrunk", () => {
  it("puts PSTN Local and unsuffixed names in ТфОП", () => {
    expect(classifySipTrunk("PSTN_Sochi_MTS_Local")).toBe("pstnTfop");
    expect(classifySipTrunk("PSTN_A")).toBe("pstnTfop");
  });

  it("puts PSTN _LDC names in long-distance", () => {
    expect(classifySipTrunk("PSTN_Sochi_MTS_LDC")).toBe("pstnLdc");
  });

  it("puts every Trunk_ name in external numbering", () => {
    expect(classifySipTrunk("Trunk_MSK")).toBe("trunk");
    expect(classifySipTrunk("Trunk_Sochi_Local")).toBe("trunk");
    expect(classifySipTrunk("Trunk_Sochi_LDC")).toBe("trunk");
  });

  it("is case-sensitive and ignores non-SIP names", () => {
    expect(classifySipTrunk("pstn_Sochi_MTS_LDC")).toBeNull();
    expect(classifySipTrunk("Service_IVR")).toBeNull();
  });
});

describe("isIncomingParking / isParkingPhantom", () => {
  it("counts SIP trunk to exact Service_Parking", () => {
    expect(isIncomingParking("PSTN_Sochi_MTS_Local", PARKING_DST)).toBe(true);
    expect(isIncomingParking("Trunk_MSK", PARKING_DST)).toBe(true);
    expect(isIncomingParking("PSTN_Sochi_MTS_LDC", PARKING_DST)).toBe(true);
  });

  it("does not count platform or non-exact parking dst", () => {
    expect(isIncomingParking("Service_IVR", PARKING_DST)).toBe(false);
    expect(isIncomingParking("PSTN_A", "Service_Parking_1")).toBe(false);
    expect(isIncomingParking("PSTN_A", "Service_IVR")).toBe(false);
  });

  it("marks phantom only when both stored sides are billing misses", () => {
    expect(
      isParkingPhantom("PSTN_A", PARKING_DST, MISSING_BILLING_LABEL, MISSING_BILLING_LABEL),
    ).toBe(true);
    expect(isParkingPhantom("PSTN_A", PARKING_DST, MISSING_BILLING_LABEL, "")).toBe(
      false,
    );
    expect(isParkingPhantom("PSTN_A", PARKING_DST, "", "")).toBe(false);
    expect(
      isParkingPhantom("Service_IVR", PARKING_DST, MISSING_BILLING_LABEL, MISSING_BILLING_LABEL),
    ).toBe(false);
  });
});

describe("classifyCallLegs", () => {
  it("counts SIP inbound and platform outbound on the same call", () => {
    expect(classifyCallLegs("PSTN_A", "Service_B")).toEqual([
      { kind: "sip", name: "PSTN_A", dir: "in" },
      { kind: "platform", name: "Service_B", dir: "out" },
    ]);
  });

  it("counts two SIP trunks as separate inbound and outbound rows", () => {
    expect(classifyCallLegs("PSTN_A", "Trunk_C")).toEqual([
      { kind: "sip", name: "PSTN_A", dir: "in" },
      { kind: "sip", name: "Trunk_C", dir: "out" },
    ]);
  });

  it("counts the same name inbound and outbound when both sides match", () => {
    expect(classifyCallLegs("PSTN_A", "PSTN_A")).toEqual([
      { kind: "sip", name: "PSTN_A", dir: "in" },
      { kind: "sip", name: "PSTN_A", dir: "out" },
    ]);
  });

  it("returns no legs when neither device matches", () => {
    expect(classifyCallLegs("Phone_1", "Phone_2")).toEqual([]);
  });
});
