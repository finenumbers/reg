import { describe, expect, it } from "vitest";
import {
  categoryMapFromEndpoints,
  leadWithCategoryAndSupplier,
  screenEndpointHeaders,
  stampCategory,
} from "@/modules/phones/category";

describe("category snapshot merge", () => {
  it("keeps the first non-empty category for a trimmed number", () => {
    const map = categoryMapFromEndpoints([
      { name: "a", endpointNumber: " 7495 ", data: { Категория: "  " } },
      { name: "b", endpointNumber: "7495", data: { Категория: "VIP" } },
      { name: "c", endpointNumber: "7495", data: { Категория: "Другая" } },
      { name: "d", endpointNumber: null, data: { Категория: "Нет" } },
    ]);
    expect(map.get("7495")).toBe("VIP");
    expect(map.size).toBe(1);
  });

  it("stamps the category and leaves the supplier key in place", () => {
    const map = new Map([["74951234567", "VIP"]]);
    expect(
      stampCategory({ Описание: "Клиент", Поставщик: "Ростелеком" }, "74951234567", map),
    ).toEqual({
      Описание: "Клиент",
      Поставщик: "Ростелеком",
      Категория: "VIP",
    });
    expect(stampCategory({ Описание: "Клиент" }, "84951234567", map)).toEqual({
      Описание: "Клиент",
    });
  });

  it("puts category and supplier first and keeps status last", () => {
    expect(
      leadWithCategoryAndSupplier([
        "Название",
        "Номер оконечного оборудования",
        "Поставщик",
        "Описание",
        "Категория",
      ]),
    ).toEqual([
      "Категория",
      "Поставщик",
      "Название",
      "Номер оконечного оборудования",
      "Описание",
    ]);
    expect(
      screenEndpointHeaders(["Статус", "Название", "Категория", "Поставщик", "Описание"]),
    ).toEqual(["Категория", "Поставщик", "Название", "Описание", "Статус"]);
  });
});
