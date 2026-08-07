import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  createSimpleWorkbook,
  replaceSheetData,
  workbookToBuffer,
  columnWidthForValues,
  XLSX_UNREGISTERED_FILL,
} from "@/lib/xlsx-export";
import { isSipUnregistered } from "@/modules/phones/sip-status";

describe("xlsx-export helpers", () => {
  it("buildXlsxBuffer produces a zip (PK) workbook", async () => {
    const wb = createSimpleWorkbook({
      sheetName: "Test",
      headers: ["A", "B"],
      rows: [["1", "2"]],
    });
    const buf = await workbookToBuffer(wb);
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(0, 2).toString("utf8")).toBe("PK");
  });

  it("columnWidthForValues uses max length", () => {
    expect(columnWidthForValues("ID", ["1", "22"])).toBe(
      Math.min(60, Math.max(8, 2 + 2)),
    );
    expect(columnWidthForValues("Название", ["abc"])).toBe(
      Math.min(60, Math.max(8, [..."Название"].length + 2)),
    );
  });

  it("replaceSheetData applies borders, highlight, and column widths", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Оконечное оборудование");
    sheet.addRow(["Название", "Номер"]);
    sheet.addRow(["old", "0"]);

    replaceSheetData(
      sheet,
      ["Название", "Номер"],
      [
        ["ok", "100"],
        ["bad", "200"],
      ],
      {
        highlightFill: XLSX_UNREGISTERED_FILL,
        highlightRow: (_i, values) => values[1] === "200",
      },
    );

    expect(sheet.getRow(2).getCell(1).value).toBe("ok");
    expect(sheet.getRow(3).getCell(1).value).toBe("bad");
    expect(sheet.getRow(3).getCell(1).fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFFEE2E2" },
    });
    expect(sheet.getRow(1).getCell(1).border?.top?.style).toBe("thin");
    expect(sheet.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(sheet.getRow(1).getCell(1).font?.name).toBe("Calibri");
    expect(sheet.getRow(1).getCell(1).font?.size).toBe(11);
    expect(sheet.getRow(1).getCell(1).alignment?.horizontal).toBe("center");
    expect(sheet.getRow(2).getCell(1).font?.name).toBe("Calibri");
    expect(sheet.getRow(2).getCell(1).font?.bold).toBe(false);
    expect(sheet.getRow(2).getCell(2).border?.left?.style).toBe("thin");
    expect(sheet.getRow(3).getCell(1).border?.bottom?.style).toBe("thin");
    expect(sheet.getColumn(1).width).toBeGreaterThanOrEqual(8);
  });
});

describe("isSipUnregistered", () => {
  it("matches Unregistered set", () => {
    const set = new Set(["200"]);
    expect(isSipUnregistered("200", set)).toBe(true);
    expect(isSipUnregistered("100", set)).toBe(false);
    expect(isSipUnregistered(null, set)).toBe(false);
  });
});
