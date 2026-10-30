import { describe, expect, it } from "vitest";
import {
  stampSupplier,
  supplierMapFromEndpoints,
  withSupplierHeader,
} from "@/modules/phones/supplier";

describe("supplier snapshot merge", () => {
  it("keeps the first non-empty supplier for a trimmed number", () => {
    const map = supplierMapFromEndpoints([
      { name: "a", endpointNumber: " 7495 ", data: { Поставщик: "  " } },
      { name: "b", endpointNumber: "7495", data: { Поставщик: "Ростелеком" } },
      { name: "c", endpointNumber: "7495", data: { Поставщик: "Другой" } },
      { name: "d", endpointNumber: null, data: { Поставщик: "Нет" } },
    ]);
    expect(map.get("7495")).toBe("Ростелеком");
    expect(map.size).toBe(1);
  });

  it("stamps the same number and leaves a renamed number empty", () => {
    const map = new Map([["74951234567", "Ростелеком"]]);
    expect(
      stampSupplier({ Описание: "Клиент" }, "74951234567", map),
    ).toEqual({ Описание: "Клиент", Поставщик: "Ростелеком" });
    expect(stampSupplier({ Описание: "Клиент" }, "84951234567", map)).toEqual({
      Описание: "Клиент",
    });
    expect(stampSupplier({ Описание: "Клиент" }, null, map)).toEqual({
      Описание: "Клиент",
    });
  });

  it("inserts the header after the terminal number once", () => {
    expect(
      withSupplierHeader(["Название", "Номер оконечного оборудования", "Описание"]),
    ).toEqual([
      "Название",
      "Номер оконечного оборудования",
      "Поставщик",
      "Описание",
    ]);
    expect(withSupplierHeader(["Поставщик", "Название"])).toEqual([
      "Поставщик",
      "Название",
    ]);
  });
});
