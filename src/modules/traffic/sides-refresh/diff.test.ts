import { describe, expect, it } from "vitest";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import {
  descriptionMapsEqual,
  diffDescriptionMaps,
  parseDescriptionMap,
  serializeDescriptionMap,
} from "@/modules/traffic/sides-refresh/diff";

describe("description map serialize/parse", () => {
  it("sorts keys and round-trips", () => {
    const map = new Map([
      ["7900", "Бета"],
      ["7391", "Сафетель"],
    ]);
    expect(Object.keys(serializeDescriptionMap(map))).toEqual(["7391", "7900"]);
    const parsed = parseDescriptionMap(serializeDescriptionMap(map));
    expect(parsed).not.toBeNull();
    expect(descriptionMapsEqual(map, parsed!)).toBe(true);
  });

  it("rejects arrays and skips empty values", () => {
    expect(parseDescriptionMap(["x"])).toBeNull();
    expect(parseDescriptionMap({ "  ": "A", "7391": "  " })?.size).toBe(0);
  });
});

describe("diffDescriptionMaps", () => {
  it("applies the full catalog when there is no snapshot", () => {
    const current = new Map([["73915190530", "Сафетель"]]);
    expect(diffDescriptionMaps(null, current)).toEqual([
      { phone: "73915190530", description: "Сафетель" },
    ]);
  });

  it("emits new, changed, and removed numbers", () => {
    const previous = new Map([
      ["100", "Старое"],
      ["200", "Держим"],
      ["300", "Уйдёт"],
    ]);
    const current = new Map([
      ["100", "Новое"],
      ["200", "Держим"],
      ["400", "Новый"],
    ]);
    const diff = diffDescriptionMaps(previous, current);
    expect(diff).toEqual(
      expect.arrayContaining([
        { phone: "100", description: "Новое" },
        { phone: "400", description: "Новый" },
        { phone: "300", description: MISSING_BILLING_LABEL },
      ]),
    );
    expect(diff).toHaveLength(3);
  });

  it("is empty when maps match", () => {
    const map = new Map([["1", "A"]]);
    expect(diffDescriptionMaps(map, new Map(map))).toEqual([]);
    expect(descriptionMapsEqual(map, new Map(map))).toBe(true);
  });
});
