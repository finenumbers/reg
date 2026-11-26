import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseSupplierXlsx } from "@/modules/phones/supplier-xlsx";

const HEAD = ["Категория", "Поставщик", "ABC", "Номер"];

async function workbook(rows: (string | number)[][]): Promise<Buffer> {
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
        ["VIP", "Ростелеком", "7 (383)", "3999999", "игнор"],
        ["", "", "", ""],
        ["", "", "7 (913)", "3999999"],
      ]),
    );
    expect(parsed).toEqual({
      ok: true,
      rows: [
        {
          rowNumber: 2,
          abc: "7 (383)",
          telephone: "3999999",
          supplier: "Ростелеком",
          category: "VIP",
        },
        {
          rowNumber: 4,
          abc: "7 (913)",
          telephone: "3999999",
          supplier: "",
          category: "",
        },
      ],
    });
  });

  it("allows an empty ABC when «Номер» holds the full number", async () => {
    const parsed = await parseSupplierXlsx(
      await workbook([HEAD, ["VIP", "Ростелеком", "", "74951234567"]]),
    );
    expect(parsed).toEqual({
      ok: true,
      rows: [
        {
          rowNumber: 2,
          abc: "",
          telephone: "74951234567",
          supplier: "Ростелеком",
          category: "VIP",
        },
      ],
    });
  });

  it("rejects ABC-only rows and the old Город header", async () => {
    const abcOnly = await parseSupplierXlsx(
      await workbook([HEAD, ["VIP", "Ростелеком", "7 (383)", ""]]),
    );
    expect(abcOnly.ok).toBe(false);
    if (!abcOnly.ok) expect(abcOnly.details[0]).toContain("«Номер»");

    const oldCity = await parseSupplierXlsx(
      await workbook([
        ["Категория", "Поставщик", "Город", "Номер"],
        ["VIP", "Ростелеком", "Москва", "74951234567"],
      ]),
    );
    expect(oldCity.ok).toBe(false);

    const namedPhone = await parseSupplierXlsx(
      await workbook([
        ["Категория", "Поставщик", "Город", "Телефонный номер"],
        ["VIP", "Ростелеком", "Москва", "74951234567"],
      ]),
    );
    expect(namedPhone.ok).toBe(false);
  });

  it("rejects a shifted header and an overlong category", async () => {
    const shifted = await parseSupplierXlsx(
      await workbook([
        ["Номер", "Поставщик", "Категория", "ABC"],
        ["3999999", "Ростелеком", "VIP", "7 (383)"],
      ]),
    );
    expect(shifted.ok).toBe(false);

    const long = await parseSupplierXlsx(
      await workbook([HEAD, ["я".repeat(201), "Ростелеком", "7 (383)", "3999999"]]),
    );
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.details[0]).toContain("«Категория»");
  });

  it("keeps a numeric local part without restoring leading zeros", async () => {
    const parsed = await parseSupplierXlsx(
      await workbook([HEAD, ["VIP", "Ростелеком", "7 (9)", 1234567]]),
    );
    expect(parsed).toEqual({
      ok: true,
      rows: [
        {
          rowNumber: 2,
          abc: "7 (9)",
          telephone: "1234567",
          supplier: "Ростелеком",
          category: "VIP",
        },
      ],
    });
  });
});
