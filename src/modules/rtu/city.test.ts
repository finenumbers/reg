import { describe, expect, it } from "vitest";
import { cityAlert, cityLabel } from "@/modules/rtu/city";
import { FREE_CALL_DIRECTION, MOBILE_RF_DIRECTION } from "@/modules/rtu/columns";

describe("city label and alert", () => {
  it("drops the city prefix and keeps the row calm", () => {
    expect(cityLabel("г. Новосибирск")).toBe("Новосибирск");
    expect(cityLabel("  г. Москва  ")).toBe("Москва");
    expect(cityAlert("г. Новосибирск")).toBe(false);
  });

  it("keeps the two named directions and does not paint them", () => {
    expect(cityLabel(MOBILE_RF_DIRECTION)).toBe(MOBILE_RF_DIRECTION);
    expect(cityAlert(MOBILE_RF_DIRECTION)).toBe(false);
    expect(cityLabel(`  ${FREE_CALL_DIRECTION}  `)).toBe(FREE_CALL_DIRECTION);
    expect(cityAlert(FREE_CALL_DIRECTION)).toBe(false);
  });

  it("paints an empty direction, a bare prefix, and any other name", () => {
    expect(cityLabel(null)).toBe("");
    expect(cityAlert(null)).toBe(true);
    expect(cityLabel("")).toBe("");
    expect(cityAlert("   ")).toBe(true);
    expect(cityLabel("г. ")).toBe("");
    expect(cityAlert("г. ")).toBe(true);
    expect(cityLabel("г.   ")).toBe("");
    expect(cityAlert("г.   ")).toBe(true);
    expect(cityLabel("МГ")).toBe("МГ");
    expect(cityAlert("Международные")).toBe(true);
  });
});
