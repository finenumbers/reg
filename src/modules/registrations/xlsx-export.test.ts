import { describe, expect, it } from "vitest";
import type { RegistrationListItem } from "@/modules/registrations/types";
import {
  REG_COLUMN_HEADERS,
  REG_COLUMN_ORDER,
} from "@/modules/registrations/ui-format";
import {
  REG_EXPORT_COLUMNS,
  registrationExportRow,
} from "@/modules/registrations/xlsx-export";

const sample: RegistrationListItem = {
  phone: "73852222205",
  description: "Клиент А",
  channelality: "10",
  status: "Registered",
  ip: "46.20.69.189",
  port: 5060,
  country: "RU",
  city: "Moscow",
  isp: "ISP",
  lastSeenAt: "2026-08-06T12:00:00.000Z",
  lastChangedAt: "2026-08-06T10:00:00.000Z",
};

describe("registrations XLSX columns", () => {
  it("exports headers in the same order as the table", () => {
    expect([...REG_EXPORT_COLUMNS]).toEqual([...REG_COLUMN_ORDER]);
    expect(REG_EXPORT_COLUMNS.map((key) => REG_COLUMN_HEADERS[key])).toEqual([
      "Телефон",
      "Канальность",
      "Описание",
      "Статус",
      "Endpoint",
      "Страна",
      "Город",
      "Оператор связи",
      "Изменение",
      "Обновление",
    ]);
  });

  it("writes capacity and empty catalog miss", () => {
    const tz = "Europe/Moscow";
    expect(registrationExportRow(sample, tz)[1]).toBe("10");
    expect(
      registrationExportRow({ ...sample, channelality: null }, tz)[1],
    ).toBe("");
    expect(registrationExportRow(sample, tz)).toHaveLength(
      REG_EXPORT_COLUMNS.length,
    );
  });
});
