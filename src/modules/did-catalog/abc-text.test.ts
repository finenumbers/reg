import { describe, expect, it } from "vitest";
import { catalogAbcExport } from "@/modules/did-catalog/abc-text";
import { cityDigitSplit } from "@/modules/rtu/city-digit-split";
import { cityLabel } from "@/modules/rtu/city";

describe("catalog ABC text", () => {
  it("matches the RTU split for a Moscow tariff row", () => {
    const split = cityDigitSplit("74953084480", "7495", [7]);
    expect(split).toEqual({ abc: "7495", telephone: "3084480" });
    expect(cityLabel("г. Москва")).toBe("Москва");
    expect(catalogAbcExport("74953084480", split.abc, split.telephone)).toBe("7 (495)");
  });

  it("leaves the stored ABC when the national number is empty", () => {
    expect(catalogAbcExport("", "7495", "")).toBe("7495");
  });
});
