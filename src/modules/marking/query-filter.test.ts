import { describe, expect, it } from "vitest";
import {
  applyMarkingQuery,
  markingCellText,
  markingFacets,
} from "@/modules/marking/query-filter";
import type { MarkingListItem } from "@/modules/marking/service";

function row(
  partial: Partial<MarkingListItem> & Pick<MarkingListItem, "id" | "phoneNumber">,
): MarkingListItem {
  return {
    client: "Клиент А",
    labelMts: null,
    labelMegafon: null,
    labelBeeline: null,
    labelT2: null,
    mavMts: null,
    mavMegafon: null,
    mavBeeline: null,
    mavT2: null,
    ...partial,
  };
}

const rows: MarkingListItem[] = [
  row({ id: "1", client: "Клиент А", phoneNumber: "70000000001", labelMts: "А" }),
  row({ id: "2", client: "Клиент Б", phoneNumber: "70000000002", labelMts: "А" }),
  row({ id: "3", client: "Клиент А", phoneNumber: "70000000003", labelMegafon: "Б" }),
];

describe("applyMarkingQuery", () => {
  it("ORs values inside one column and ANDs columns", () => {
    expect(
      applyMarkingQuery(rows, {
        filters: { client: ["Клиент А", "Клиент Б"] },
      }).map((item) => item.id),
    ).toEqual(["1", "2", "3"]);
    expect(
      applyMarkingQuery(rows, {
        filters: { client: ["Клиент А"], labelMts: ["А"] },
      }).map((item) => item.id),
    ).toEqual(["1"]);
  });

  it("matches an empty marking cell as (пусто)", () => {
    expect(
      applyMarkingQuery(rows, { filters: { labelMts: ["__empty__"] } }).map(
        (item) => item.id,
      ),
    ).toEqual(["3"]);
    expect(markingCellText(rows[2]!, "labelMts")).toBe("");
  });

  it("ignores an unknown filter key", () => {
    expect(applyMarkingQuery(rows, { filters: { nope: ["x"] } })).toEqual(rows);
  });

  it("leaves the open column's other values in its menu and narrows another column", () => {
    const open = markingFacets(rows, {
      column: "client",
      filters: { client: ["Клиент А"] },
    });
    expect(open.items.map((item) => item.value).sort()).toEqual(["Клиент А", "Клиент Б"]);

    const narrowed = markingFacets(rows, {
      column: "client",
      filters: { labelMts: ["А"] },
    });
    expect(narrowed.items.map((item) => item.value).sort()).toEqual([
      "Клиент А",
      "Клиент Б",
    ]);
    expect(
      markingFacets(rows, {
        column: "phoneNumber",
        filters: { client: ["Клиент А"], labelMts: ["А"] },
      }).items.map((item) => item.value),
    ).toEqual(["70000000001"]);
  });
});
