import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { workbookToBuffer } from "@/lib/xlsx-export";
import { MASK_HEADERS, parseMaskXlsx } from "@/modules/masks/parse-xlsx";
import { MASK_COLUMN_HEADERS, MASK_COLUMN_ORDER } from "@/modules/masks/query-filter";
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

  it("keeps a hyphen in the mask and the stored purchase text", async () => {
    const workbook = buildMaskExportWorkbook([
      {
        digitLength: 5,
        category: "Городской",
        abc: null,
        mask: "00-000",
        maskType: null,
        premium: "10.5",
        purchase: "200000",
      },
    ]);
    const parsed = await parseMaskXlsx(await workbookToBuffer(workbook));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toMatchObject({
      digitLength: 5,
      mask: "00-000",
      premium: "10.5",
      purchase: "200000",
    });
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

  it("writes purchase before premium in the same order as the screen", () => {
    expect(MASK_COLUMN_ORDER.map((id) => MASK_COLUMN_HEADERS[id])).toEqual([
      ...MASK_HEADERS,
    ]);
    const workbook = buildMaskExportWorkbook([
      {
        digitLength: 7,
        category: "Мобильный",
        abc: null,
        mask: "XYZZZZZ",
        maskType: "=тип",
        purchase: "=покупка",
        premium: "=премиум",
      },
    ]);
    const sheet = workbook.getWorksheet("Маски");
    const headers = MASK_HEADERS.map(
      (_, index) => sheet?.getRow(1).getCell(index + 1).value,
    );
    expect(headers).toEqual([...MASK_HEADERS]);
    expect(sheet?.getRow(2).getCell(5).value).toBe("'=тип");
    expect(sheet?.getRow(2).getCell(6).value).toBe("'=покупка");
    expect(sheet?.getRow(2).getCell(7).value).toBe("'=премиум");
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
