import { describe, expect, it } from "vitest";
import {
  findRegistrationTable,
  PCOMM_REGISTRATIONS_TITLE,
} from "@/modules/registrations/rtu-catalog";

const TITLE = PCOMM_REGISTRATIONS_TITLE;

describe("findRegistrationTable", () => {
  it("keeps the monitoring summary page", () => {
    const found = findRegistrationTable(
      [
        {
          objectId: "06.1501.01",
          title: TITLE,
          path: "Мониторинг ПКомм;Регистрации (ПКомм)",
          type: "table",
        },
        {
          objectId: "06.1599.01",
          title: TITLE,
          path: "Мониторинг ПКомм;Данные по модулям;;Регистрации (ПКомм)",
          type: "table",
        },
      ],
      TITLE,
    );
    expect(found).toEqual({ ok: true, objectId: "06.1501.01" });
  });

  it("fails when the title is missing", () => {
    const found = findRegistrationTable([], TITLE);
    expect(found).toEqual({ ok: false, detail: `Таблица «${TITLE}» не найдена.` });
  });

  it("names the mismatched paths and ignores a per-module copy", () => {
    const found = findRegistrationTable(
      [
        {
          objectId: "06.1599.01",
          title: TITLE,
          path: "Другое;Регистрации (ПКомм)",
          type: "table",
        },
      ],
      TITLE,
    );
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.detail).toContain("Другое;Регистрации (ПКомм)");
  });

  it("fails when two summary pages share the title", () => {
    const found = findRegistrationTable(
      [
        {
          objectId: "06.1501.01",
          title: TITLE,
          path: "Мониторинг ПКомм;Регистрации (ПКомм)",
          type: "table",
        },
        {
          objectId: "06.1501.02",
          title: TITLE,
          path: "Мониторинг ПКомм;Регистрации (ПКомм)",
          type: "table",
        },
      ],
      TITLE,
    );
    expect(found).toEqual({ ok: false, detail: `Несколько таблиц «${TITLE}».` });
  });
});
