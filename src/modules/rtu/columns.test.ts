import { describe, expect, it } from "vitest";
import {
  RTU_COLUMNS,
  RTU_COLUMNS_WITHOUT_MASKS,
  RTU_HEADERS,
  isRtuColumn,
  isRtuMaskColumn,
  visibleRtuColumns,
} from "@/modules/rtu/columns";

describe("visible RTU columns", () => {
  it("returns the full column contract when masks are shown", () => {
    expect(visibleRtuColumns(true)).toBe(RTU_COLUMNS);
    expect(isRtuColumn("mask")).toBe(true);
    expect(isRtuColumn("maskType")).toBe(true);
    expect(isRtuColumn("purchase")).toBe(true);
    expect(isRtuColumn("premium")).toBe(true);
    expect(RTU_HEADERS.mask).toBe("Маска");
    expect(RTU_HEADERS.maskType).toBe("Тип");
    expect(RTU_HEADERS.purchase).toBe("Покупка");
    expect(RTU_HEADERS.premium).toBe("Премиум");
  });

  it("drops the four mask columns and keeps capacity beside operator", () => {
    expect(visibleRtuColumns(false)).toBe(RTU_COLUMNS_WITHOUT_MASKS);
    expect(RTU_COLUMNS.length - RTU_COLUMNS_WITHOUT_MASKS.length).toBe(4);
    expect(RTU_COLUMNS_WITHOUT_MASKS).toEqual(
      RTU_COLUMNS.filter((column) => !isRtuMaskColumn(column)),
    );
    const capacityIndex = RTU_COLUMNS_WITHOUT_MASKS.indexOf("capacity");
    expect(RTU_COLUMNS_WITHOUT_MASKS[capacityIndex + 1]).toBe("operator");
    for (const column of ["mask", "maskType", "purchase", "premium"] as const) {
      expect(RTU_COLUMNS_WITHOUT_MASKS).not.toContain(column);
      expect(isRtuMaskColumn(column)).toBe(true);
      expect(RTU_COLUMNS).toContain(column);
    }
    expect(isRtuMaskColumn("operator")).toBe(false);
    expect(isRtuMaskColumn("city")).toBe(false);
    expect(RTU_COLUMNS_WITHOUT_MASKS.at(-1)).toBe("activation");
  });
});
