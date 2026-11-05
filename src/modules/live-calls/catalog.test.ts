import { describe, expect, it } from "vitest";
import {
  findActiveModules,
  findTalkColumn,
  findTransitTable,
  findTransitTemplate,
  PCOMM_TEMPLATE_LEAF,
  PUPR_TEMPLATE_LEAF,
  type CatalogObject,
} from "@/modules/live-calls/catalog";
import { PCOMM_TALK_TITLES, PUPR_TALK_TITLES } from "@/modules/live-calls/columns";

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
        table(
          "08.2504.01",
          "Подсистема коммутации;Мониторинг ПКомм;Транзитные вызовы (ПКомм)",
        ),
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
      [
        table(
          "08.2504.01",
          "Подсистема коммутации;Другая папка;Транзитные вызовы (ПКомм)",
        ),
      ],
      TITLE,
    );
    expect(found).toEqual({ ok: false, reason: "none" });
  });

  it("prefers the shallower monitoring path and refuses a tie", () => {
    const deeper = findTransitTable(
      [
        table(
          "08.2504.02",
          "Подсистема коммутации;Мониторинг ПКомм;узел;Транзитные вызовы (ПКомм)",
        ),
        table(
          "08.2504.01",
          "Подсистема коммутации;Мониторинг ПКомм;Транзитные вызовы (ПКомм)",
        ),
      ],
      TITLE,
    );
    expect(deeper).toEqual({ ok: true, objectId: "08.2504.01" });

    const tie = findTransitTable(
      [
        table(
          "08.2504.01",
          "Подсистема коммутации;Мониторинг ПКомм;Транзитные вызовы (ПКомм)",
        ),
        table("08.2504.02", "Коммутация;Мониторинг ПКомм;Транзитные вызовы (ПКомм)"),
      ],
      TITLE,
    );
    expect(tie).toEqual({ ok: false, reason: "many" });
  });

  it("does not take the live per-module template as the summary", () => {
    const found = findTransitTable(
      [
        table(
          "08.2599.01",
          "Подсистема коммутации;Мониторинг ПКомм;Данные по модулям;;Конференции Class 4",
        ),
      ],
      TITLE,
    );
    expect(found).toEqual({ ok: false, reason: "none" });
  });
});

const PCOMM_TEMPLATE =
  "Подсистема коммутации;Мониторинг ПКомм;Данные по модулям;;Конференции Class 4";
const PUPR_TEMPLATE = "Подсистема коммутации;Мониторинг ПКомм;Данные по модулям;;Вызовы";

describe("findTransitTemplate", () => {
  it("selects the one empty-module template and ignores a named module", () => {
    const found = findTransitTemplate(
      [
        table(
          "08.2599.02",
          "Подсистема коммутации;Мониторинг ПКомм;Данные по модулям;signaling-1;Конференции Class 4",
        ),
        table("08.2599.01", PCOMM_TEMPLATE),
        table(
          "08.2504.01",
          "Подсистема коммутации;Мониторинг ПКомм;Транзитные вызовы (ПКомм)",
        ),
      ],
      TITLE,
      PCOMM_TEMPLATE_LEAF,
    );
    expect(found).toEqual({ ok: true, objectId: "08.2599.01" });
  });

  it("rejects a different leaf, a filled module, and a second template", () => {
    expect(
      findTransitTemplate(
        [table("08.2599.01", PUPR_TEMPLATE, "Транзитные вызовы (ПУпр)")],
        "Транзитные вызовы (ПУпр)",
        PUPR_TEMPLATE_LEAF,
      ),
    ).toEqual({ ok: true, objectId: "08.2599.01" });
    expect(
      findTransitTemplate(
        [table("08.2599.01", PUPR_TEMPLATE)],
        TITLE,
        PCOMM_TEMPLATE_LEAF,
      ),
    ).toEqual({
      ok: false,
      reason: "none",
    });
    expect(
      findTransitTemplate(
        [
          table("08.2599.01", PCOMM_TEMPLATE),
          table("08.2599.02", `${PCOMM_TEMPLATE};ещё`),
        ],
        TITLE,
        PCOMM_TEMPLATE_LEAF,
      ),
    ).toEqual({ ok: true, objectId: "08.2599.01" });
    expect(
      findTransitTemplate(
        [table("08.2599.01", PCOMM_TEMPLATE), table("08.2599.02", PCOMM_TEMPLATE)],
        TITLE,
        PCOMM_TEMPLATE_LEAF,
      ),
    ).toEqual({ ok: false, reason: "many" });
  });
});

describe("findActiveModules", () => {
  const path = "Подсистема коммутации;Мониторинг ПКомм;Активные модули";

  it("selects the summary page and ignores a module copy", () => {
    expect(
      findActiveModules([
        table("08.2600.02", `${path};signaling-1`, "Активные модули"),
        table("08.2600.01", path, "Активные модули"),
      ]),
    ).toEqual({ ok: true, objectId: "08.2600.01" });
    expect(
      findActiveModules([
        table("08.2600.01", path, "Активные модули"),
        table("08.2600.02", path, "Активные модули"),
      ]),
    ).toEqual({
      ok: false,
      reason: "many",
    });
    expect(findActiveModules([table("08.2600.01", path)])).toEqual({
      ok: false,
      reason: "none",
    });
  });
});

describe("findTalkColumn", () => {
  const duration = {
    name: "dur",
    title: "Время разговора",
    dataMask: null,
    haveLookup: false,
    pk: false,
    ctlType: null,
    action: null,
    actionUnreadable: false,
  };
  const seconds = {
    name: "talk_sec",
    title: "Время разговора, сек",
    dataMask: null,
    haveLookup: false,
    pk: false,
    ctlType: null,
    action: null,
    actionUnreadable: false,
  };

  it("prefers the first unique handbook title", () => {
    expect(findTalkColumn([duration, seconds], PUPR_TALK_TITLES)).toEqual({
      name: "talk_sec",
      dataMask: null,
      haveLookup: false,
      explicitSeconds: true,
    });
    expect(findTalkColumn([duration, seconds], PCOMM_TALK_TITLES)).toEqual({
      name: "dur",
      dataMask: null,
      haveLookup: false,
      explicitSeconds: false,
    });
    expect(findTalkColumn([], PCOMM_TALK_TITLES)).toBeNull();
  });

  it("skips a duplicated title and a name that cannot be sent", () => {
    expect(
      findTalkColumn(
        [duration, { ...duration, name: "dur_b" }, seconds],
        PCOMM_TALK_TITLES,
      ),
    ).toBeNull();
    expect(findTalkColumn([{ ...seconds, name: "1bad" }], PUPR_TALK_TITLES)).toBeNull();
  });
});
