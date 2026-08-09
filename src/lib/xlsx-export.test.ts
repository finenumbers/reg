import { describe, expect, it } from "vitest";
import path from "node:path";
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

  it("columnWidthForValues uses max length without tight upper clamp", () => {
    expect(columnWidthForValues("ID", ["1", "22"])).toBe(Math.max(8, 2 + 2));
    expect(columnWidthForValues("Название", ["abc"])).toBe(
      Math.max(8, [..."Название"].length + 2),
    );
    const long = "x".repeat(80);
    expect(columnWidthForValues("H", [long])).toBe(82);
  });

  it("replaceSheetData applies borders, highlight, autofit, and autoFilter", async () => {
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
    expect(sheet.getColumn(1).width).toBeGreaterThanOrEqual(
      [..."Название"].length + 2,
    );
    expect(sheet.autoFilter).toMatchObject({
      from: { row: 1, column: 1 },
      to: { row: 3, column: 2 },
    });
  });

  it("styleCell runs after base styles", () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("T");
    sheet.addRow(["A", "B"]);
    replaceSheetData(sheet, ["A", "B"], [["1", "2"]], {
      styleCell: ({ colIndex, cell }) => {
        if (colIndex === 0) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFFC000" },
          };
        }
      },
    });
    expect(sheet.getRow(1).getCell(1).fill).toMatchObject({
      fgColor: { argb: "FFFFC000" },
    });
    expect(sheet.getRow(1).getCell(1).border?.top?.style).toBe("thin");
    expect(sheet.getRow(1).getCell(1).font?.bold).toBe(true);
  });

  it("clears template Groups rows without doubling (phones-export.xlsx)", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(
      path.join(process.cwd(), "ops/templates/phones-export.xlsx"),
    );
    const sheet = wb.getWorksheet("Группы");
    expect(sheet).toBeTruthy();
    if (!sheet) return;

    const rows = Array.from({ length: 40 }, (_, i) => [
      String(i + 1),
      `Group_${i + 1}`,
    ]);
    replaceSheetData(sheet, ["ID", "Название"], rows);

    const seen: string[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const id = String(row.getCell(1).value ?? "").trim();
      const name = String(row.getCell(2).value ?? "").trim();
      if (!id && !name) return;
      seen.push(`${id}|${name}`);
    });
    expect(seen).toHaveLength(40);
    expect(new Set(seen).size).toBe(40);
    expect(seen[0]).toBe("1|Group_1");
    expect(seen[39]).toBe("40|Group_40");
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
