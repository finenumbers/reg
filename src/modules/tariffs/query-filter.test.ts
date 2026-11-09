import { describe, expect, it } from "vitest";
import {
  applyTariffQuery,
  tariffCellText,
  tariffFacets,
} from "@/modules/tariffs/query-filter";
import type { TariffListItem } from "@/modules/tariffs/service";

function row(
  partial: Partial<TariffListItem> & Pick<TariffListItem, "id" | "abc">,
): TariffListItem {
  return {
    direction: "Город",
    digitLengths: [10],
    numbering: [12, 13],
    region: "Москва",
    price: "1.5",
    ...partial,
  };
}

const rows: TariffListItem[] = [
  row({ id: "ru", abc: "7495", digitLengths: null, region: null, price: "1.5" }),
  row({
    id: "kz",
    abc: "77",
    digitLengths: [10],
    direction: "Казахстан",
    price: "1.500000",
    numbering: null,
  }),
  row({
    id: "de",
    abc: "375",
    digitLengths: [10, 11],
    direction: "Беларусь",
    region: "",
    price: "2",
    numbering: [7],
  }),
];

describe("applyTariffQuery", () => {
  it("paints 11 for every ABC that starts with 7, even when the stored length differs", () => {
    expect(tariffCellText(rows[0]!, "digitLength")).toBe("11");
    expect(tariffCellText(rows[1]!, "digitLength")).toBe("11");
    expect(tariffCellText(rows[2]!, "digitLength")).toBe("10/11");
    expect(
      applyTariffQuery(rows, { filters: { digitLength: ["11"] } }).map((item) => item.id),
    ).toEqual(["ru", "kz"]);
  });

  it("collapses prices of different precision to the two-decimal screen text", () => {
    expect(tariffCellText(rows[0]!, "price")).toBe("1.50");
    expect(tariffCellText(rows[1]!, "price")).toBe("1.50");
    expect(
      applyTariffQuery(rows, { filters: { price: ["1.50"] } }).map((item) => item.id),
    ).toEqual(["ru", "kz"]);
  });

  it("keeps numbering as one slash-separated token", () => {
    expect(tariffCellText(rows[2]!, "numbering")).toBe("7");
    expect(tariffCellText(rows[0]!, "numbering")).toBe("12/13");
    expect(
      applyTariffQuery(rows, { filters: { numbering: ["12/13"] } }).map((item) => item.id),
    ).toEqual(["ru"]);
  });

  it("ORs values inside one column and ANDs columns", () => {
    expect(
      applyTariffQuery(rows, {
        filters: { direction: ["Город", "Казахстан"] },
      }).map((item) => item.id),
    ).toEqual(["ru", "kz"]);
    expect(
      applyTariffQuery(rows, {
        filters: { direction: ["Город"], digitLength: ["11"] },
      }).map((item) => item.id),
    ).toEqual(["ru"]);
  });

  it("keeps sort order and ignores an unknown filter key", () => {
    const ordered = [rows[2]!, rows[0]!, rows[1]!];
    expect(applyTariffQuery(ordered, { filters: { nope: ["x"] } })).toBe(ordered);
    expect(
      applyTariffQuery(ordered, { filters: { price: ["1.50"] } }).map((item) => item.id),
    ).toEqual(["ru", "kz"]);
  });

  it("leaves the open column's other values and narrows by another column", () => {
    const open = tariffFacets(rows, {
      column: "direction",
      filters: { direction: ["Город"] },
    });
    expect(open.items.map((item) => item.value).sort()).toEqual([
      "Беларусь",
      "Город",
      "Казахстан",
    ]);

    const narrowed = tariffFacets(rows, {
      column: "direction",
      filters: { digitLength: ["11"] },
    });
    expect(narrowed.items.map((item) => item.value).sort()).toEqual(["Город", "Казахстан"]);
  });

  it("finds an empty region by the label (пусто)", () => {
    expect(
      applyTariffQuery(rows, { filters: { region: ["__empty__"] } }).map((item) => item.id),
    ).toEqual(["ru", "de"]);
    const found = tariffFacets(rows, { column: "region", q: "пусто" });
    expect(found.items.map((item) => item.value)).toEqual(["__empty__"]);
    expect(found.items[0]?.count).toBe(2);
  });
});
