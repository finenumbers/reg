import { describe, expect, it } from "vitest";
import {
  isSipUnregistered,
  sipUnregisteredFilterPhones,
  toUnregisteredPhoneSet,
} from "@/modules/phones/sip-status";

describe("isSipUnregistered", () => {
  const set = toUnregisteredPhoneSet(["100", "200"]);

  it("marks Unregistered phones", () => {
    expect(isSipUnregistered("100", set)).toBe(true);
  });

  it("does not mark Registered / unknown", () => {
    expect(isSipUnregistered("300", set)).toBe(false);
  });

  it("does not mark null/empty endpoint", () => {
    expect(isSipUnregistered(null, set)).toBe(false);
    expect(isSipUnregistered("", set)).toBe(false);
  });
});

describe("toUnregisteredPhoneSet", () => {
  it("drops empty strings", () => {
    expect(toUnregisteredPhoneSet(["", "100"]).has("100")).toBe(true);
    expect(toUnregisteredPhoneSet(["", "100"]).has("")).toBe(false);
  });
});

describe("sipUnregisteredFilterPhones", () => {
  it("returns null for empty set (no Prisma in:[])", () => {
    expect(sipUnregisteredFilterPhones([])).toBeNull();
    expect(sipUnregisteredFilterPhones([""])).toBeNull();
  });

  it("returns phones for IN filter", () => {
    expect(sipUnregisteredFilterPhones(["100", "200"])).toEqual([
      "100",
      "200",
    ]);
  });
});
