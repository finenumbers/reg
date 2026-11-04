import { describe, expect, it } from "vitest";
import {
  LIVE_CALL_HEADERS,
  PCOMM_FIELDS,
  PCOMM_TALK_TITLES,
  PUPR_FIELDS,
  PUPR_TALK_TITLES,
} from "@/modules/live-calls/columns";

describe("LIVE_CALL_HEADERS", () => {
  it("shows the screen names in screen order", () => {
    expect(
      LIVE_CALL_HEADERS.map((column) => [column.key, column.header, column.bold]),
    ).toEqual([
      ["category", "Категория", false],
      ["state", "Состояние", false],
      ["startedAt", "Время начала", false],
      ["connectedAt", "Время соединения", false],
      ["outA", "А-номер", true],
      ["sideA", "Сторона A", false],
      ["outB", "Б-номер", true],
      ["sideB", "Сторона B", false],
      ["direction", "Направление", false],
      ["seconds", "Секунды", false],
      ["sourceName", "Инициирующее устройство", false],
      ["destName", "Терминирующее устройство", false],
      ["dialpeer", "Объект набора", false],
      ["sourceSignal", "Инициатор", false],
      ["destSignal", "Терминатор", false],
    ]);
  });

  it("keeps the switch titles that describeTable matches", () => {
    expect(PCOMM_FIELDS).toEqual({
      conferenceId: "Conference ID ПКомм",
      startedAt: "Время начала",
      connectedAt: "Время соединения",
      sourceSignal: "Адрес инициатора (сигн.)",
      outA: "Исходящий А-номер",
      outB: "Исходящий Б-номер",
      destSignal: "Адрес терм. устр-ва (сигн.)",
    });
    expect(PUPR_FIELDS).toEqual({
      conferenceId: "Conference ID ПКомм",
      state: "Состояние вызова",
      sourceName: "Имя инициатора",
      dialpeer: "Объект набора",
      destName: "Имя терм. устройства",
    });
    expect(PCOMM_TALK_TITLES).toEqual(["Время разговора", "Время разговора, сек"]);
    expect(PUPR_TALK_TITLES).toEqual(["Время разговора, сек", "Время разговора"]);
  });
});
