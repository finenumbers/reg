import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseCostEstimateXlsx } from "@/modules/cost-estimate/parse-xlsx";
import { writeCostEstimateXlsx } from "@/modules/cost-estimate/write-xlsx";
import { CALL_TYPE } from "@/modules/traffic/call-class";
import {
  XLSX_OPRS_MTS_FILL,
} from "@/modules/cost-estimate/fills";

async function workbookBuffer(
  rows: Array<[string | number | Date, string, string | number]>,
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("in");
  sheet.addRow(["Дата", "B-номер", "Продолжительность"]);
  for (const row of rows) sheet.addRow(row);
  const buf = await book.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe("parseCostEstimateXlsx", () => {
  it("parses E.164 and integer seconds", async () => {
    const buffer = await workbookBuffer([
      ["2026-01-02", "+79031234567", 125],
    ]);
    const parsed = await parseCostEstimateXlsx(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toEqual([
      {
        rowNumber: 2,
        dateDisplay: "2026-01-02",
        bNumberRaw: "+79031234567",
        bDigits: "79031234567",
        seconds: 125,
      },
    ]);
  });

  it("rejects a bad header and a non-admitted B without echoing the number", async () => {
    const badHeader = await workbookBuffer([["a", "b", "c"]]);
    // Force wrong headers by rebuilding
    const book = new ExcelJS.Workbook();
    book.addWorksheet("in").addRow(["Дата", "Номер", "Сек"]);
    const headerBuf = Buffer.from(await book.xlsx.writeBuffer());
    const header = await parseCostEstimateXlsx(headerBuf);
    expect(header.ok).toBe(false);
    if (header.ok) return;
    expect(header.details.join(" ")).not.toMatch(/\d{10}/);

    const badB = await workbookBuffer([["d", "+7495123456", 10]]);
    const parsed = await parseCostEstimateXlsx(badB);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.details[0]).toContain("B-номер");
    expect(parsed.details.join(" ")).not.toContain("7495123456");
  });

  it("preserves a Date cell as a display string round-trip", async () => {
    const buffer = await workbookBuffer([
      [new Date(2026, 0, 15), "79031234567", 4],
    ]);
    const parsed = await parseCostEstimateXlsx(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]?.dateDisplay).toMatch(/2026/);

    const out = await writeCostEstimateXlsx([
      {
        dateDisplay: parsed.rows[0]!.dateDisplay,
        bNumberRaw: parsed.rows[0]!.bNumberRaw,
        callType: CALL_TYPE.mobile,
        direction: "Мобильные РФ",
        charge: "3.00",
        network: "МТС",
        operator: "ПАО МТС",
        geography: "Москва",
        fillTone: "red",
      },
    ]);
    const reload = new ExcelJS.Workbook();
    await reload.xlsx.load(out.buffer as unknown as ExcelJS.Buffer);
    const sheet = reload.worksheets[0]!;
    expect(sheet.getRow(1).getCell(1).text).toBe("Дата");
    expect(sheet.getRow(2).getCell(1).text).toBe(parsed.rows[0]!.dateDisplay);
    const fill = sheet.getRow(2).getCell(1).fill as ExcelJS.FillPattern;
    expect(fill.fgColor?.argb).toBe(
      (XLSX_OPRS_MTS_FILL as ExcelJS.FillPattern).fgColor?.argb,
    );
  });
});
