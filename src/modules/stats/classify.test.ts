import { describe, expect, it } from "vitest";
import {
  classifyCallLegs,
  classifyDevice,
  isPlatform,
  isSipTrunk,
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
