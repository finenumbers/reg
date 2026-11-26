import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  dateCellDisplay,
  excelSerialToDate,
  formatDateTimeLocal,
  parseCostEstimateXlsx,
} from "@/modules/cost-estimate/parse-xlsx";
import { writeCostEstimateXlsx } from "@/modules/cost-estimate/write-xlsx";
import { CALL_TYPE } from "@/modules/traffic/call-class";
import { XLSX_OPRS_MTS_FILL } from "@/modules/cost-estimate/fills";

async function workbookBuffer(
  rows: Array<
    [string | number | Date, string, string, string | number]
  >,
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("in");
  sheet.addRow(["Дата", "A-номер", "B-номер", "Продолжительность"]);
  for (const row of rows) sheet.addRow(row);
  const buf = await book.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe("formatDateTimeLocal", () => {
  it("formats local date and time with zero-padding", () => {
    expect(formatDateTimeLocal(new Date(2026, 0, 15, 14, 30, 5))).toBe(
      "2026-01-15 14:30:05",
    );
    expect(formatDateTimeLocal(new Date(2026, 0, 15))).toBe(
      "2026-01-15 00:00:00",
    );
  });
});

describe("excelSerialToDate", () => {
  it("converts a known Excel serial day", () => {
    // 2026-01-15 00:00:00 UTC from Excel 1900 system ≈ 46037
    const d = excelSerialToDate(46037);
    expect(d).not.toBeNull();
    expect(formatDateTimeLocal(d!)).toMatch(/^2026-01-1[45] /);
  });

  it("rejects non-serial numbers", () => {
    expect(excelSerialToDate(0)).toBeNull();
    expect(excelSerialToDate(100000)).toBeNull();
    expect(excelSerialToDate(Number.NaN)).toBeNull();
  });
});

describe("parseCostEstimateXlsx", () => {
  it("parses E.164 A/B and integer seconds", async () => {
    const buffer = await workbookBuffer([
      ["2026-01-02", "", "+79031234567", 125],
    ]);
    const parsed = await parseCostEstimateXlsx(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toEqual([
      {
        rowNumber: 2,
        dateDisplay: "2026-01-02",
        aNumberRaw: "",
        aDigits: "",
        bNumberRaw: "+79031234567",
        bDigits: "79031234567",
        seconds: 125,
      },
    ]);
  });

  it("strips a GMT suffix from a text date without inventing time", async () => {
    const buffer = await workbookBuffer([
      ["2026-01-02 14:30:05 GMT+0700 (Indochina Time)", "", "79031234567", 4],
    ]);
    const parsed = await parseCostEstimateXlsx(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]?.dateDisplay).toBe("2026-01-02 14:30:05");
    expect(parsed.rows[0]?.dateDisplay).not.toMatch(/GMT/i);
  });

  it("rejects a bad header and a non-admitted A/B without echoing the number", async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("in").addRow(["Дата", "B-номер", "Продолжительность"]);
    const headerBuf = Buffer.from(await book.xlsx.writeBuffer());
    const header = await parseCostEstimateXlsx(headerBuf);
    expect(header.ok).toBe(false);
    if (header.ok) return;
    expect(header.details.join(" ")).toContain("A-номер");

    const badA = await workbookBuffer([
      ["d", "+7495123456", "79031234567", 10],
    ]);
    const parsedA = await parseCostEstimateXlsx(badA);
    expect(parsedA.ok).toBe(false);
    if (parsedA.ok) return;
    expect(parsedA.details[0]).toContain("A-номер");
    expect(parsedA.details.join(" ")).not.toContain("7495123456");

    const badB = await workbookBuffer([["d", "", "+7495123456", 10]]);
    const parsedB = await parseCostEstimateXlsx(badB);
    expect(parsedB.ok).toBe(false);
    if (parsedB.ok) return;
    expect(parsedB.details[0]).toContain("B-номер");
    expect(parsedB.details.join(" ")).not.toContain("7495123456");
  });

  it("formats a Date cell with time without GMT and round-trips the display", async () => {
    const buffer = await workbookBuffer([
      [new Date(2026, 0, 15, 14, 30, 5), "", "79031234567", 4],
    ]);
    const parsed = await parseCostEstimateXlsx(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]?.dateDisplay).toBe("2026-01-15 14:30:05");
    expect(parsed.rows[0]?.dateDisplay).not.toMatch(/GMT/i);

    const out = await writeCostEstimateXlsx([
      {
        dateDisplay: parsed.rows[0]!.dateDisplay,
        aNumberRaw: "",
        bNumberRaw: parsed.rows[0]!.bNumberRaw,
        callType: CALL_TYPE.mobile,
        direction: "Мобильные РФ",
        region: "",
        seconds: 4,
        minutes: 1,
        price: "3",
        charge: "3.00",
        network: "МТС",
        operator: "ПАО МТС",
        geography: "Москва",
        fillTone: "red",
        registryMissing: false,
      },
    ]);
    const reload = new ExcelJS.Workbook();
    await reload.xlsx.load(out.buffer as unknown as ExcelJS.Buffer);
    const sheet = reload.worksheets[0]!;
    expect(sheet.getRow(1).getCell(1).text).toBe("Дата");
    expect(sheet.getRow(1).getCell(2).text).toBe("A-номер");
    expect(sheet.getRow(2).getCell(1).text).toBe("2026-01-15 14:30:05");
    expect(sheet.getRow(2).getCell(1).text).not.toMatch(/GMT/i);
    expect(sheet.getRow(2).getCell(4).font?.bold).toBe(true);
    const fill = sheet.getRow(2).getCell(1).fill as ExcelJS.FillPattern;
    expect(fill.fgColor?.argb).toBe(
      (XLSX_OPRS_MTS_FILL as ExcelJS.FillPattern).fgColor?.argb,
    );
    expect(sheet.getRow(3).getCell(10).value).toBe(3);
    expect(sheet.getRow(3).getCell(10).numFmt).toBe("#,##0.00");
  });
});

describe("dateCellDisplay", () => {
  it("formats an Excel serial number as local date-time", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("in");
    const cell = sheet.getRow(1).getCell(1);
    cell.value = 46037.604224537; // ~2026-01-15 14:30
    expect(dateCellDisplay(cell)).toMatch(/^2026-01-1[45] \d{2}:\d{2}:\d{2}$/);
  });
});
