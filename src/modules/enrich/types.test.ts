import { describe, expect, it } from "vitest";
import {
  descriptionOrMissing,
  pstnOrMissing,
} from "@/modules/enrich/types";

describe("enrich field rules", () => {
  it("uses Нет данных when description is missing", () => {
    expect(descriptionOrMissing(undefined)).toBe("Нет данных");
    expect(descriptionOrMissing("  ")).toBe("Нет данных");
    expect(descriptionOrMissing("Шлюз")).toBe("Шлюз");
  });

  it("marks PSTN miss independently of description", () => {
    expect(pstnOrMissing(undefined).missing).toBe(true);
    expect(pstnOrMissing({ found: false, operator: null, garTerritory: null })).toEqual({
      operator: "Нет данных",
      geography: "Нет данных",
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
