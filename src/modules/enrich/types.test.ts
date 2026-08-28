import { describe, expect, it } from "vitest";
import {
  MISSING_BILLING_LABEL,
  MISSING_PSTN_LABEL,
  descriptionOrMissing,
  pstnOrMissing,
} from "@/modules/enrich/types";

describe("enrich field rules", () => {
  it("uses Нет в биллинге when description is missing", () => {
    expect(descriptionOrMissing(undefined)).toBe(MISSING_BILLING_LABEL);
    expect(descriptionOrMissing("  ")).toBe(MISSING_BILLING_LABEL);
    expect(descriptionOrMissing("Шлюз")).toBe("Шлюз");
  });

  it("marks PSTN miss independently of description", () => {
    expect(pstnOrMissing(undefined).missing).toBe(true);
    expect(pstnOrMissing({ found: false, operator: null, garTerritory: null })).toEqual({
      operator: MISSING_PSTN_LABEL,
      geography: MISSING_PSTN_LABEL,
      missing: true,
    });
    expect(
      pstnOrMissing({
        found: true,
        operator: "МТС",
        garTerritory: "Кемерово",
      }),
    ).toEqual({
      operator: "МТС",
      geography: "Кемерово",
      missing: false,
    });
  });
});
