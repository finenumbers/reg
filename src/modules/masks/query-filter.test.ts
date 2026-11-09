import { describe, expect, it } from "vitest";
import {
  applyMaskQuery,
  maskCellText,
  maskFacets,
} from "@/modules/masks/query-filter";
import type { MaskListItem } from "@/modules/masks/service";

function row(partial: Partial<MaskListItem> & Pick<MaskListItem, "id" | "mask">): MaskListItem {
  return {
    digitLength: partial.mask.length,
    category: "Городской",
    abc: "495",
    maskType: null,
    premium: null,
    purchase: null,
    ...partial,
  };
}

const rows: MaskListItem[] = [
  row({ id: "1", mask: "00000", category: "Городской", abc: "495" }),
  row({ id: "2", mask: "00000", category: "Мобильный", abc: null }),
  row({ id: "3", mask: "ABCDE", category: "Бесплатный вызов", abc: "812", maskType: "A" }),
];

describe("applyMaskQuery", () => {
  it("ORs values inside one column and ANDs columns", () => {
    expect(
      applyMaskQuery(rows, {
        filters: { category: ["Городской", "Мобильный"] },
      }).map((item) => item.id),
    ).toEqual(["1", "2"]);
    expect(
      applyMaskQuery(rows, {
        filters: { category: ["Городской"], mask: ["00000"] },
      }).map((item) => item.id),
    ).toEqual(["1"]);
  });

  it("keeps sort order", () => {
    const ordered = [rows[2]!, rows[0]!, rows[1]!];
    expect(
      applyMaskQuery(ordered, { filters: { digitLength: ["5"] } }).map((item) => item.id),
    ).toEqual(["3", "1", "2"]);
  });

  it("ignores an unknown filter key", () => {
    expect(applyMaskQuery(rows, { filters: { nope: ["x"] } })).toEqual(rows);
  });

  it("matches an empty ABC as (пусто)", () => {
    expect(
      applyMaskQuery(rows, { filters: { abc: ["__empty__"] } }).map((item) => item.id),
    ).toEqual(["2"]);
    expect(maskCellText(rows[1]!, "abc")).toBe("");
  });

  it("leaves the open column's other values in its menu and narrows another column", () => {
    const open = maskFacets(rows, {
      column: "category",
      filters: { category: ["Городской"] },
    });
    expect(open.items.map((item) => item.value).sort()).toEqual([
      "Бесплатный вызов",
      "Городской",
      "Мобильный",
    ]);

    const narrowed = maskFacets(rows, {
      column: "category",
      filters: { mask: ["00000"] },
    });
    expect(narrowed.items.map((item) => item.value).sort()).toEqual([
      "Городской",
      "Мобильный",
    ]);
  });

  it("finds an empty cell by the label (пусто)", () => {
    const found = maskFacets(rows, { column: "abc", q: "пусто" });
    expect(found.items.map((item) => item.value)).toEqual(["__empty__"]);
  });

  it("searches the full set before the 200-value cut", () => {
    const many: MaskListItem[] = [];
    for (let i = 0; i < 200; i += 1) {
      const mask = `A${String(i).padStart(4, "0")}`;
      many.push(row({ id: `a${i}`, mask, category: "Городской" }));
      many.push(row({ id: `b${i}`, mask, category: "Мобильный" }));
    }
    many.push(row({ id: "rare", mask: "ZZZZZ", category: "Городской" }));

    const page = maskFacets(many, { column: "mask", limit: 200 });
    expect(page.truncated).toBe(true);
    expect(page.items.some((item) => item.value === "ZZZZZ")).toBe(false);

    const found = maskFacets(many, { column: "mask", q: "zzzzz", limit: 200 });
    expect(found.items.map((item) => item.value)).toEqual(["ZZZZZ"]);
  });
});
