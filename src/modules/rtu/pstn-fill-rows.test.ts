import { describe, expect, it } from "vitest";
import { MOBILE_RF_DIRECTION } from "@/modules/rtu/columns";
import { blankPstnRowIds, mergePstnLabels } from "@/modules/rtu/pstn-fill-rows";
import type { RtuItem } from "@/modules/rtu/types";

function row(over: Partial<RtuItem> = {}): RtuItem {
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
    mask: "",
    maskType: "",
    sale: "",
    premium: "",
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

  it("copies geography into the region only for a mobile city", () => {
    const [mobile] = mergePstnLabels(
      [row({ city: MOBILE_RF_DIRECTION, region: "тариф", cityAlert: false })],
      [{ id: "a", operator: "МТС", geography: "край" }],
    );
    expect(mobile?.region).toBe("край");
    expect(mobile?.geography).toBe("край");
    const [landline] = mergePstnLabels(
      [row({ region: "Ростовская область" })],
      [{ id: "a", operator: "МТС", geography: "край" }],
    );
    expect(landline?.region).toBe("Ростовская область");
  });

  it("collapses a compound mobile geography and leaves the geography cell", () => {
    const geography = "Московская область, Город Москва";
    const [mobile] = mergePstnLabels(
      [row({ city: MOBILE_RF_DIRECTION, region: "", cityAlert: false })],
      [{ id: "a", operator: "МТС", geography }],
    );
    expect(mobile?.region).toBe("Московская область");
    expect(mobile?.geography).toBe(geography);
    const [landline] = mergePstnLabels(
      [row({ region: "Ростовская область" })],
      [{ id: "a", operator: "МТС", geography }],
    );
    expect(landline?.region).toBe("Ростовская область");
    expect(landline?.geography).toBe(geography);
  });

  it("returns the same rows when nothing changes", () => {
    const items = [row({ operator: "МТС", geography: "край" })];
    expect(
      mergePstnLabels(items, [{ id: "a", operator: "МТС", geography: "край" }]),
    ).toBe(items);
    expect(mergePstnLabels(items, [])).toBe(items);
  });
});
