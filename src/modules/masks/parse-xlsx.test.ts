import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  MASK_HEADERS,
  parseMaskXlsx,
  sanitizeMaskFilename,
} from "@/modules/masks/parse-xlsx";

async function workbook(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Маски");
  rows.forEach((cells, index) => {
    const row = ws.getRow(index + 1);
    cells.forEach((cell, column) => {
      row.getCell(column + 1).value = cell as ExcelJS.CellValue;
    });
  });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

const header = [...MASK_HEADERS];

describe("parseMaskXlsx", () => {
  it("keeps a text mask and a leading zero in ABC", async () => {
    const buf = await workbook([
      header,
      ["5", " Городской ", "0495", "00000", "", "", ""],
      [],
      [6, "Служебный", "", "00000X", "", "", 10],
    ]);
    const result = await parseMaskXlsx(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
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
      {
        sortIndex: 1,
        digitLength: 6,
        category: "Служебный",
        abc: null,
        mask: "00000X",
        maskType: null,
        premium: "10",
        purchase: null,
      },
    ]);
  });

  it("rejects a header row that is not in file order", async () => {
    const scrambled = await parseMaskXlsx(
      await workbook([
        ["Покупка", "Маска", "Премиум", "Тип", "ABC", "Категория", "Разрядность"],
        ["", "XYZZZZZ", "", "Золотой", 495, "Мобильный", "7"],
      ]),
    );
    expect(scrambled.ok).toBe(false);
    if (scrambled.ok) return;
    expect(scrambled.details[0]).toMatch(/в этом порядке/);

    const previous = await parseMaskXlsx(
      await workbook([
        ["Разрядность", "Категория", "ABC", "Маска", "Тип", "Премиум", "Покупка"],
        ["5", "Городской", "", "00000", "", "премиум", "покупка"],
      ]),
    );
    expect(previous.ok).toBe(false);
    if (previous.ok) return;
    expect(previous.details[0]).toMatch(/в этом порядке/);
  });

  it("rejects a numeric mask, a short mask, and a lowercase letter", async () => {
    const numeric = new ExcelJS.Workbook();
    const sheet = numeric.addWorksheet("Маски");
    header.forEach((name, index) => {
      sheet.getRow(1).getCell(index + 1).value = name;
    });
    const row = sheet.getRow(2);
    row.getCell(1).value = 5;
    row.getCell(2).value = "Городской";
    row.getCell(4).value = 0;
    const numericResult = await parseMaskXlsx(Buffer.from(await numeric.xlsx.writeBuffer()));
    expect(numericResult.ok).toBe(false);
    if (numericResult.ok) return;
    expect(numericResult.details[0]).toMatch(/текстом/);

    const bad = await parseMaskXlsx(
      await workbook([
        header,
        ["7", "Городской", "", "000000", "", "", ""],
        ["5", "Городской", "", "0000x", "", "", ""],
        ["05", "Городской", "", "00000", "", "", ""],
      ]),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.details[0]).toMatch(/длина равна/);
    expect(bad.details[1]).toMatch(/длина равна/);
    expect(bad.details[2]).toMatch(/Разрядность/);
  });

  it("rejects a date in premium and a file with no data rows", async () => {
    const dated = new ExcelJS.Workbook();
    const sheet = dated.addWorksheet("Маски");
    header.forEach((name, index) => {
      sheet.getRow(1).getCell(index + 1).value = name;
    });
    const row = sheet.getRow(2);
    row.getCell(1).value = "5";
    row.getCell(2).value = "Городской";
    row.getCell(4).value = "00000";
    row.getCell(header.indexOf("Премиум") + 1).value = new Date(Date.UTC(2024, 0, 2));
    const dateResult = await parseMaskXlsx(Buffer.from(await dated.xlsx.writeBuffer()));
    expect(dateResult.ok).toBe(false);
    if (dateResult.ok) return;
    expect(dateResult.details[0]).toMatch(/Премиум/);

    const empty = await parseMaskXlsx(await workbook([header]));
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.details).toEqual(["В файле нет строк с данными"]);
  });

  it("rejects an extra column", async () => {
    const result = await parseMaskXlsx(
      await workbook([[...header, "Лишнее"], ["5", "Городской", "", "00000", "", "", "", "x"]]),
    );
    expect(result.ok).toBe(false);
  });

  it("sanitizes a filename", () => {
    expect(sanitizeMaskFilename("")).toBe("masks.xlsx");
    expect(sanitizeMaskFilename("a\u0000b.xlsx")).toBe("ab.xlsx");
  });
});

const realFile = process.env.MASKS_XLSX;

describe.skipIf(!realFile)("parseMaskXlsx operator workbook", () => {
  it("accepts the attached masks file", async () => {
    const result = await parseMaskXlsx(readFileSync(realFile!));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(13_500);
    expect(result.rows[0]).toMatchObject({
      sortIndex: 0,
      digitLength: 5,
      category: "Городской",
      abc: null,
      mask: "00000",
      maskType: null,
      premium: null,
      purchase: null,
    });
  });
});
