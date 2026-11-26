import { describe, expect, it } from "vitest";
import { collapseShownRegion } from "@/modules/rtu/columns";

const NBSP = "\u00a0";

describe("collapseShownRegion", () => {
  it("replaces the compound labels and keeps every other string", () => {
    expect(collapseShownRegion("Московская область, Город Москва")).toBe(
      "Московская область",
    );
    expect(collapseShownRegion("Город Москва, Московская область")).toBe(
      "Московская область",
    );
    expect(collapseShownRegion("Ленинградская область, Город Санкт-Петербург")).toBe(
      "Ленинградская область",
    );
    expect(collapseShownRegion("Город Санкт-Петербург, Ленинградская область")).toBe(
      "Ленинградская область",
    );
    expect(collapseShownRegion("Город Севастополь, Республика Крым")).toBe(
      "Республика Крым",
    );
    expect(collapseShownRegion("Республика Крым, Город Севастополь")).toBe(
      "Республика Крым",
    );
    expect(collapseShownRegion("  Московская область, Город Москва  ")).toBe(
      "Московская область",
    );
    expect(collapseShownRegion(`${NBSP}Московская область, Город Москва${NBSP}`)).toBe(
      `${NBSP}Московская область, Город Москва${NBSP}`,
    );
    expect(collapseShownRegion("Московская область")).toBe("Московская область");
    expect(collapseShownRegion(" Ростовская область ")).toBe(" Ростовская область ");
    expect(collapseShownRegion("Московская область,Город Москва")).toBe(
      "Московская область,Город Москва",
    );
  });
});