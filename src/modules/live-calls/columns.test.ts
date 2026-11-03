import { describe, expect, it } from "vitest";
import {
  LIVE_CALL_HEADERS,
  PCOMM_FIELDS,
  PUPR_FIELDS,
} from "@/modules/live-calls/columns";

describe("LIVE_CALL_HEADERS", () => {
  it("shows the screen names in screen order", () => {
    expect(
      LIVE_CALL_HEADERS.map((column) => [column.key, column.header, column.bold]),
    ).toEqual([
      ["state", "Состояние", false],
      ["startedAt", "Время начала", false],
      ["connectedAt", "Время соединения", false],
      ["outA", "А-номер", true],
      ["sideA", "Сторона A", false],
      ["outB", "Б-номер", true],
      ["sideB", "Сторона B", false],
      ["sourceName", "Инициирующее устройство", false],
      ["destName", "Терминирующее устройство", false],
      ["dialpeer", "Объект набора", false],
    ]);
  });

  it("keeps the switch titles that describeTable matches", () => {
    expect(PCOMM_FIELDS).toEqual({
      conferenceId: "Conference ID ПКомм",
      startedAt: "Время начала",
      connectedAt: "Время соединения",
      outA: "Исходящий А-номер",
      outB: "Исходящий Б-номер",
    });
    expect(PCOMM_FIELDS).not.toHaveProperty("sourceSignal");
    expect(PCOMM_FIELDS).not.toHaveProperty("destSignal");
    expect(PUPR_FIELDS).toEqual({
      conferenceId: "Conference ID ПКомм",
      state: "Состояние вызова",
      sourceName: "Имя инициатора",
      dialpeer: "Объект набора",
      destName: "Имя терм. устройства",
    });
  });
});
