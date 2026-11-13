import { describe, expect, it } from "vitest";
import {
  RTU_COLUMNS,
  RTU_COLUMNS_WITH_MASKS,
  RTU_COLUMNS_WITHOUT_MASKS,
  RTU_HEADERS,
  isRtuColumn,
  isRtuMaskColumn,
  rtuFilterColumnStaysOpen,
  visibleRtuColumns,
} from "@/modules/rtu/columns";

const MASK_COLUMNS = ["mask", "maskType", "purchase", "premium"] as const;
const HIDDEN_WHEN_ON = ["category", "supplier", "source"] as const;

describe("visible RTU columns", () => {
  it("hides category, supplier, and source when masks are shown", () => {
    const hidden = new Set<string>(HIDDEN_WHEN_ON);
    expect(visibleRtuColumns(true)).toBe(RTU_COLUMNS_WITH_MASKS);
    expect(RTU_COLUMNS_WITH_MASKS).toHaveLength(RTU_COLUMNS.length - HIDDEN_WHEN_ON.length);
    expect(RTU_COLUMNS_WITH_MASKS[0]).toBe("city");
    expect(RTU_COLUMNS_WITH_MASKS.at(-1)).toBe("activation");
    expect(RTU_COLUMNS_WITH_MASKS).toEqual(RTU_COLUMNS.filter((column) => !hidden.has(column)));
    for (const column of HIDDEN_WHEN_ON) {
      expect(RTU_COLUMNS_WITH_MASKS).not.toContain(column);
      expect(RTU_COLUMNS).toContain(column);
    }
    for (const column of MASK_COLUMNS) {
      expect(RTU_COLUMNS_WITH_MASKS).toContain(column);
      expect(isRtuColumn(column)).toBe(true);
    }
    const capacityIndex = RTU_COLUMNS_WITH_MASKS.indexOf("capacity");
    expect(RTU_COLUMNS_WITH_MASKS.slice(capacityIndex, capacityIndex + 5)).toEqual([
      "capacity",
      "mask",
      "maskType",
      "purchase",
      "premium",
    ]);
    expect(RTU_HEADERS.category).toBe("Категория");
    expect(RTU_HEADERS.supplier).toBe("Поставщик");
    expect(RTU_HEADERS.source).toBe("Источник");
    expect(RTU_HEADERS.mask).toBe("Маска");
    expect(RTU_HEADERS.maskType).toBe("Тип");
    expect(RTU_HEADERS.purchase).toBe("Покупка");
    expect(RTU_HEADERS.premium).toBe("Премиум");
  });

  it("drops the four mask columns and keeps category, supplier, and source", () => {
    expect(visibleRtuColumns(false)).toBe(RTU_COLUMNS_WITHOUT_MASKS);
    expect(RTU_COLUMNS.length - RTU_COLUMNS_WITHOUT_MASKS.length).toBe(4);
    expect(RTU_COLUMNS_WITHOUT_MASKS).toEqual(
      RTU_COLUMNS.filter((column) => !isRtuMaskColumn(column)),
    );
    expect(RTU_COLUMNS_WITHOUT_MASKS.slice(0, 3)).toEqual([...HIDDEN_WHEN_ON]);
    const capacityIndex = RTU_COLUMNS_WITHOUT_MASKS.indexOf("capacity");
    expect(RTU_COLUMNS_WITHOUT_MASKS[capacityIndex + 1]).toBe("operator");
    for (const column of MASK_COLUMNS) {
      expect(RTU_COLUMNS_WITHOUT_MASKS).not.toContain(column);
      expect(isRtuMaskColumn(column)).toBe(true);
      expect(RTU_COLUMNS).toContain(column);
    }
    expect(isRtuMaskColumn("operator")).toBe(false);
    expect(isRtuMaskColumn("city")).toBe(false);
    expect(RTU_COLUMNS_WITHOUT_MASKS.at(-1)).toBe("activation");
  });

  it("keeps shared columns in contract order in both switch positions", () => {
    const mask = new Set<string>(MASK_COLUMNS);
    const hiddenWhenOn = new Set<string>(HIDDEN_WHEN_ON);
    const shared = RTU_COLUMNS.filter((column) => !mask.has(column) && !hiddenWhenOn.has(column));
    expect(RTU_COLUMNS_WITH_MASKS.filter((column) => !mask.has(column))).toEqual(shared);
    expect(RTU_COLUMNS_WITHOUT_MASKS.filter((column) => !hiddenWhenOn.has(column))).toEqual(
      shared,
    );
  });

  it("closes a header menu only for the columns that leave the screen", () => {
    for (const column of HIDDEN_WHEN_ON) {
      expect(rtuFilterColumnStaysOpen(column, true)).toBe(false);
      expect(rtuFilterColumnStaysOpen(column, false)).toBe(true);
    }
    for (const column of MASK_COLUMNS) {
      expect(rtuFilterColumnStaysOpen(column, true)).toBe(true);
      expect(rtuFilterColumnStaysOpen(column, false)).toBe(false);
    }
    expect(rtuFilterColumnStaysOpen("city", true)).toBe(true);
    expect(rtuFilterColumnStaysOpen("city", false)).toBe(true);
    expect(rtuFilterColumnStaysOpen("activation", true)).toBe(true);
    expect(rtuFilterColumnStaysOpen("activation", false)).toBe(true);
  });
});
