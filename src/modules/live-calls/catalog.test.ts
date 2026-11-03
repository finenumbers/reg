import { describe, expect, it } from "vitest";
import { findTransitTable, type CatalogObject } from "@/modules/live-calls/catalog";

const TITLE = "Транзитные вызовы (ПКомм)";

function table(objectId: string, path: string, title = TITLE): CatalogObject {
  return { objectId, title, path, type: "table" };
}

describe("findTransitTable", () => {
  it("keeps the summary page and drops the per-module copy", () => {
    const found = findTransitTable(
      [
        table(
          "08.2599.01",
          "Подсистема коммутации;Мониторинг ПКомм;Данные по модулям;signaling-1;Конференции Class 4",
        ),
        table("08.2504.01", "Подсистема коммутации;Мониторинг ПКомм;Транзитные вызовы (ПКомм)"),
      ],
      TITLE,
    );
    expect(found).toEqual({ ok: true, objectId: "08.2504.01" });
  });

  it("accepts one nil path, which the live WSDL allows", () => {
    const found = findTransitTable([table("08.2504.01", "")], TITLE);
    expect(found).toEqual({ ok: true, objectId: "08.2504.01" });
  });

  it("does not take a page that sits outside the monitoring folder", () => {
    const found = findTransitTable(
      [table("08.2504.01", "Подсистема коммутации;Другая папка;Транзитные вызовы (ПКомм)")],
      TITLE,
    );
    expect(found).toEqual({ ok: false, reason: "none" });
  });

  it("prefers the shallower monitoring path and refuses a tie", () => {
    const deeper = findTransitTable(
      [
        table("08.2504.02", "Подсистема коммутации;Мониторинг ПКомм;узел;Транзитные вызовы (ПКомм)"),
        table("08.2504.01", "Подсистема коммутации;Мониторинг ПКомм;Транзитные вызовы (ПКомм)"),
      ],
      TITLE,
    );
    expect(deeper).toEqual({ ok: true, objectId: "08.2504.01" });

    const tie = findTransitTable(
      [
        table("08.2504.01", "Подсистема коммутации;Мониторинг ПКомм;Транзитные вызовы (ПКомм)"),
        table("08.2504.02", "Коммутация;Мониторинг ПКомм;Транзитные вызовы (ПКомм)"),
      ],
      TITLE,
    );
    expect(tie).toEqual({ ok: false, reason: "many" });
  });
});
