import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseSupplierXlsx } from "@/modules/phones/supplier-xlsx";

const HEAD = ["Категория", "Поставщик", "Город", "Номер"];

async function workbook(rows: string[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Поставщики");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe("parseSupplierXlsx", () => {
  it("reads the first four columns and ignores a column to the right", async () => {
    const parsed = await parseSupplierXlsx(
      await workbook([
        [...HEAD, "Клиент"],
        ["VIP", "Ростелеком", "Москва", "74951234567", "игнор"],
        ["", "", "", ""],
        ["", "", "Казань", "1234"],
      ]),
    );
    expect(parsed).toEqual({
      ok: true,
      rows: [
        {
          rowNumber: 2,
          number: "74951234567",
          supplier: "Ростелеком",
          category: "VIP",
        },
        { rowNumber: 4, number: "1234", supplier: "", category: "" },
      ],
    });
  });

  it("rejects a file that is not in column order", async () => {
    const oldFile = await parseSupplierXlsx(
      await workbook([
        ["Поставщик", "Номер"],
        ["Ростелеком", "1"],
      ]),
    );
    expect(oldFile.ok).toBe(false);

    const shifted = await parseSupplierXlsx(
      await workbook([
        ["Номер", "Поставщик", "Категория", "Город"],
        ["1", "Ростелеком", "VIP", "Москва"],
      ]),
    );
    expect(shifted.ok).toBe(false);
  });

  it("rejects an empty number when another cell is filled, and an overlong category", async () => {
    const cityOnly = await parseSupplierXlsx(
      await workbook([HEAD, ["VIP", "", "Москва", ""]]),
    );
    expect(cityOnly.ok).toBe(false);
    if (!cityOnly.ok) expect(cityOnly.details[0]).toContain("Строка 2");

    const long = await parseSupplierXlsx(
      await workbook([HEAD, ["я".repeat(201), "Ростелеком", "", "1"]]),
    );
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.details[0]).toContain("«Категория»");
  });
});
