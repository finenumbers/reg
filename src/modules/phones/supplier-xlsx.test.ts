import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseSupplierXlsx } from "@/modules/phones/supplier-xlsx";

async function workbook(rows: string[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Поставщики");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe("parseSupplierXlsx", () => {
  it("reads Поставщик and Номер and ignores an extra column", async () => {
    const parsed = await parseSupplierXlsx(
      await workbook([
        ["Лишнее", "Номер", "Поставщик"],
        ["x", "74951234567", "Ростелеком"],
        ["", "", ""],
        ["y", "1234", ""],
      ]),
    );
    expect(parsed).toEqual({
      ok: true,
      rows: [
        { rowNumber: 2, number: "74951234567", supplier: "Ростелеком" },
        { rowNumber: 4, number: "1234", supplier: "" },
      ],
    });
  });

  it("rejects a missing header and an overlong supplier", async () => {
    const missing = await parseSupplierXlsx(
      await workbook([["Номер"], ["1"]]),
    );
    expect(missing.ok).toBe(false);

    const long = await parseSupplierXlsx(
      await workbook([["Поставщик", "Номер"], ["я".repeat(201), "1"]]),
    );
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.details[0]).toContain("Строка 2");
  });
});
