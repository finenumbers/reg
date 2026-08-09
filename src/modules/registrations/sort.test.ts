import { describe, expect, it } from "vitest";
import {
  compareRegistrationPhones,
  sortRegistrationItemsByPhone,
} from "@/modules/registrations/sort";

describe("sortRegistrationItemsByPhone", () => {
  it("orders phones numerically ascending", () => {
    expect(
      sortRegistrationItemsByPhone([
        { phone: "73912193303" },
        { phone: "420910902600" },
        { phone: "73852222205" },
      ]).map((r) => r.phone),
    ).toEqual(["420910902600", "73852222205", "73912193303"]);
  });

  it("compareRegistrationPhones is ascending", () => {
    expect(compareRegistrationPhones("9", "10")).toBeLessThan(0);
    expect(compareRegistrationPhones("738", "739")).toBeLessThan(0);
  });
});
