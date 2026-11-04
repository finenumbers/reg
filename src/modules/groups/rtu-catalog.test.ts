import { describe, expect, it } from "vitest";
import {
  acceptIncomingGroups,
  findIncomingGroupsTable,
  type IncomingGroupObject,
} from "@/modules/groups/rtu-catalog";

const TITLE = "Входящие группы";
const PATH = "Оборудование;Входящие группы";

function table(
  objectId: string,
  path: string,
  title = TITLE,
): IncomingGroupObject {
  return { objectId, title, path, type: "table" };
}

describe("findIncomingGroupsTable", () => {
  it("keeps the equipment page", () => {
    const found = findIncomingGroupsTable([
      table("06.1499.01", "Оборудование;Данные по модулям;;Входящие группы"),
      table("06.1401.01", PATH),
      table("06.1498.01", "Маршрутизация;Объекты набора", "Объекты набора"),
    ]);
    expect(found).toEqual({ ok: true, objectId: "06.1401.01" });
  });

  it("names the paths when the folder does not match", () => {
    const found = findIncomingGroupsTable([
      table("06.1499.01", "Подсистема коммутации;Данные по модулям;;Входящие группы"),
    ]);
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.detail).toContain("заголовков 1");
    expect(found.detail).toContain("Данные по модулям");
  });

  it("rejects two equipment pages", () => {
    const found = findIncomingGroupsTable([
      table("06.1401.01", PATH),
      table("06.1402.01", "Корень;Оборудование;Входящие группы"),
    ]);
    expect(found).toEqual({
      ok: false,
      detail: "Несколько таблиц «Входящие группы».",
    });
  });

  it("rejects a missing page", () => {
    expect(findIncomingGroupsTable([]).ok).toBe(false);
  });
});

describe("acceptIncomingGroups", () => {
  it("keeps a leading zero and an empty list", () => {
    expect(
      acceptIncomingGroups([{ externalId: "01", name: "PSTN_Moscow" }]),
    ).toEqual({
      ok: true,
      groups: [{ externalId: "01", name: "PSTN_Moscow" }],
    });
    expect(acceptIncomingGroups([])).toEqual({ ok: true, groups: [] });
  });

  it("rejects a blank id, a repeated name, and a semicolon", () => {
    expect(acceptIncomingGroups([{ externalId: " ", name: "A" }]).ok).toBe(false);
    expect(
      acceptIncomingGroups([
        { externalId: "1", name: "A" },
        { externalId: "2", name: "A" },
      ]).ok,
    ).toBe(false);
    const semicolon = acceptIncomingGroups([{ externalId: "1", name: "A;B" }]);
    expect(semicolon.ok).toBe(false);
    if (semicolon.ok) return;
    expect(semicolon.detail).toContain("точка с запятой");
  });
});
