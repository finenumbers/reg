import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { emptySmgFields, SMG_COLUMNS, SMG_HEADER_LABELS } from "@/modules/smg/columns";
import {
  smgExportCell,
  smgExportColumns,
  smgExportFilename,
  writeSmgExportFile,
} from "@/modules/smg/xlsx-export";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("SMG xlsx columns", () => {
  it("lists every CDR column for the calls page, then the antifraud labels", () => {
    expect(smgExportColumns("calls").map((column) => column.header)).toEqual([
      ...SMG_COLUMNS.map((column) => column.label),
      "АнтиФрод",
      "Статус АнтиФрод",
      "Вход Dev",
      "Вход Prod",
      "Parking",
    ]);
  });

  it("starts the traffic file with the screen and keeps UniqueTag once", () => {
    const headers = smgExportColumns("traffic").map((column) => column.header);
    expect(headers.slice(0, 2)).toEqual(["Дата", "Время"]);
    expect(headers.filter((header) => header === "Секунды")).toEqual(["Секунды"]);
    expect(headers.filter((header) => header === SMG_HEADER_LABELS.uniqueTag)).toEqual([
      SMG_HEADER_LABELS.uniqueTag,
    ]);
    expect(headers).not.toContain("Длительность вызова");
    expect(headers).toContain(SMG_HEADER_LABELS.radiusSessionId);
    expect(headers.filter((header) => header === "АнтиФрод")).toEqual(["АнтиФрод"]);
    expect(headers.filter((header) => header === "Статус АнтиФрод")).toEqual([
      "Статус АнтиФрод",
    ]);
    expect(headers).not.toContain("Тип входа");
    expect(headers).not.toContain("Тип выхода");
    expect(headers.filter((header) => header === SMG_HEADER_LABELS.incomingType)).toEqual(
      [SMG_HEADER_LABELS.incomingType],
    );
    expect(headers.filter((header) => header === "Вход Dev")).toEqual(["Вход Dev"]);
    expect(headers.indexOf("Вход Dev")).toBeLessThan(
      headers.indexOf(SMG_HEADER_LABELS.uniqueTag),
    );
    expect(
      headers.slice(headers.indexOf("АнтиФрод"), headers.indexOf("АнтиФрод") + 5),
    ).toEqual([
      "АнтиФрод",
      "Статус АнтиФрод",
      "Вход Dev",
      "Вход Prod",
      "Parking",
    ]);
  });

  it("keeps a phone as text and neutralizes a formula", () => {
    const row = emptySmgFields();
    row.setupTime = "2026-10-16 17:07:27";
    row.incomingCgpn = "9277751863";
    row.uniqueTag = "=1+1";
    row.radiusSessionId = "+7900";
    const traffic = smgExportColumns("traffic");
    const cell = (header: string) =>
      smgExportCell(
        traffic.find((column) => column.header === header)!,
        row,
      );
    expect(cell("Дата")).toBe("16.10.2026");
    expect(cell("Время")).toBe("17:07:27");
    expect(cell("А вход")).toBe("9277751863");
    expect(cell(SMG_HEADER_LABELS.uniqueTag)).toBe("'=1+1");
    expect(cell(SMG_HEADER_LABELS.radiusSessionId)).toBe("'+7900");
  });

  it("drops path characters from the gateway in the file name", () => {
    expect(smgExportFilename("calls", "2026-10", "mts/../../x")).toBe(
      "Звонки на SMG 2026-10 mts....x.xlsx",
    );
    expect(smgExportFilename("traffic", "2026-10", "")).toBe("Трафик SMG 2026-10.xlsx");
  });
});

describe("SMG xlsx file", () => {
  it("writes the phone as a string cell", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "smg-xlsx-test-"));
    dirs.push(dir);
    const filePath = path.join(dir, "out.xlsx");
    const row = emptySmgFields();
    row.incomingCgpn = "9277751863";
    row.uniqueTag = "=1+1";
    await writeSmgExportFile({
      layout: "calls",
      filePath,
      eachRow: async (visit) => {
        await visit(row);
      },
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.getWorksheet("Звонки на SMG");
    const headers = sheet?.getRow(1).values;
    expect(Array.isArray(headers) ? headers.slice(1) : []).toEqual([
      ...SMG_COLUMNS.map((column) => column.label),
      "АнтиФрод",
      "Статус АнтиФрод",
      "Вход Dev",
      "Вход Prod",
      "Parking",
    ]);
    const phoneIndex =
      SMG_COLUMNS.findIndex((column) => column.field === "incomingCgpn") + 1;
    const tagIndex = SMG_COLUMNS.findIndex((column) => column.field === "uniqueTag") + 1;
    const phone = sheet?.getRow(2).getCell(phoneIndex).value;
    const tag = sheet?.getRow(2).getCell(tagIndex).value;
    expect(phone).toBe("9277751863");
    expect(typeof phone).toBe("string");
    expect(tag).toBe("'=1+1");
  });
});
