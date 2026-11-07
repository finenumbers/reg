import { describe, expect, it } from "vitest";
import {
  blankPstnRowIds,
  mergePstnLabels,
} from "@/modules/number-geography/pstn-fill-rows";
import type { NumberGeographyItem } from "@/modules/number-geography/types";

function row(over: Partial<NumberGeographyItem> = {}): NumberGeographyItem {
  return {
    id: "a",
    category: "",
    city: "Ростов-на-Дону",
    region: "",
    abc: "",
    telephone: "",
    supplier: "",
    number: "78633334460",
    pstnStatus: "pending",
    client: 'ООО "ИНТЕРНОД"',
    capacity: "4",
    operator: "",
    geography: "",
    title: "Электротехмонтаж ТД",
    activation: "",
    source: "",
    missing: false,
    unregistered: false,
    cityAlert: true,
    ...over,
  };
}

describe("blankPstnRowIds", () => {
  it("keeps only a pair of empty PSTN cells and skips ids already known to be invalid", () => {
    const ids = blankPstnRowIds(
      [
        row({ id: "blank" }),
        row({ id: "again" }),
        row({
          id: "labeled",
          operator: "Нет в реестре МинЦифры",
          geography: "Нет в реестре МинЦифры",
        }),
        row({ id: "operator", operator: "МТС", geography: "" }),
        row({ id: "dup" }),
        row({ id: "dup" }),
      ],
      new Set(["again"]),
    );
    expect(ids).toEqual(["blank", "dup"]);
  });
});

describe("mergePstnLabels", () => {
  it("replaces the two PSTN cells and leaves the rest of the row", () => {
    const original = row({ unregistered: true });
    const [merged] = mergePstnLabels(
      [original],
      [{ id: "a", operator: "МТС", geography: "край" }],
    );
    expect(merged).toEqual({
      ...original,
      operator: "МТС",
      geography: "край",
    });
    expect(merged?.cityAlert).toBe(true);
    expect(merged?.city).toBe("Ростов-на-Дону");
  });

  it("returns the same rows when nothing changes", () => {
    const items = [row({ operator: "МТС", geography: "край" })];
    expect(
      mergePstnLabels(items, [{ id: "a", operator: "МТС", geography: "край" }]),
    ).toBe(items);
    expect(mergePstnLabels(items, [])).toBe(items);
  });
});
