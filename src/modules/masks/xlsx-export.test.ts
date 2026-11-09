import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { workbookToBuffer } from "@/lib/xlsx-export";
import { parseMaskXlsx } from "@/modules/masks/parse-xlsx";
import { buildMaskExportWorkbook, maskExportCells } from "@/modules/masks/xlsx-export";

describe("mask XLSX export", () => {
  it("round-trips a text mask and a leading zero through the parser", async () => {
    const workbook = buildMaskExportWorkbook([
      {
        digitLength: 5,
        category: "Городской",
        abc: "0495",
        mask: "00000",
        maskType: null,
        premium: null,
        purchase: null,
      },
    ]);
    const sheet = workbook.getWorksheet("Маски");
    expect(sheet?.getRow(2).getCell(4).numFmt).toBe("@");
    const parsed = await parseMaskXlsx(await workbookToBuffer(workbook));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toEqual([
      {
        sortIndex: 0,
        digitLength: 5,
        category: "Городской",
        abc: "0495",
        mask: "00000",
        maskType: null,
        premium: null,
        purchase: null,
      },
    ]);
  });

  it("prefixes a formula-like category", () => {
    expect(
      maskExportCells({
        digitLength: 5,
        category: "=cmd",
        abc: null,
        mask: "00000",
        maskType: null,
        premium: null,
        purchase: null,
      })[1],
    ).toBe("'=cmd");
  });
});

describe("mask export cell types survive ExcelJS reload", () => {
  it("keeps 00000 as text after a write", async () => {
    const workbook = buildMaskExportWorkbook([
      {
        digitLength: 5,
        category: "Городской",
        abc: null,
        mask: "00000",
        maskType: null,
        premium: null,
        purchase: null,
      },
    ]);
    const again = new ExcelJS.Workbook();
    await again.xlsx.load((await workbookToBuffer(workbook)) as never);
    const mask = again.getWorksheet("Маски")?.getRow(2).getCell(4).value;
    expect(mask).toBe("00000");
  });
});
