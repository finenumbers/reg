import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  formatTariffDecimal,
  parseTariffXlsx,
  sanitizeTariffFilename,
  TARIFF_HEADERS,
  TARIFF_MAX_ERRORS,
} from "@/modules/tariffs/parse-xlsx";

async function workbook(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Тарифы");
  rows.forEach((cells, index) => {
    const row = ws.getRow(index + 1);
    cells.forEach((cell, column) => {
      row.getCell(column + 1).value = cell as ExcelJS.CellValue;
    });
  });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

const header = [...TARIFF_HEADERS];

describe("parseTariffXlsx", () => {
  it("keeps a text ABC prefix and comma prices", async () => {
    const buf = await workbook([
      header,
      ["Москва", "0495", "1,50"],
      [],
      ["Казань", "843", "10"],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { sortIndex: 0, direction: "Москва", abc: "0495", price: "1.5" },
      { sortIndex: 1, direction: "Казань", abc: "843", price: "10" },
    ]);
  });

  it("accepts columns in any order and a numeric ABC cell", async () => {
    const buf = await workbook([
      ["Цена", "ABC", "Направления"],
      ["1 234,50", 495, "Москва"],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({
      sortIndex: 0,
      direction: "Москва",
      abc: "495",
      price: "1234.5",
    });
  });

  it("stores a numeric direction as text and allows zero and negative money", async () => {
    const buf = await workbook([
      header,
      [100, "812", 0],
      ["Скидка", "812", -0.5],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({
      direction: "100",
      abc: "812",
      price: "0",
    });
    expect(result.rows[1]).toMatchObject({ direction: "Скидка", price: "-0.5" });
  });

  it("rejects a broken header without reading rows as data", async () => {
    const buf = await workbook([
      ["Направление", "ABC", "Цена", "Себестоимость"],
      ["Москва", "495", "1", "1"],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details[0]).toMatch(/первой строке/);
  });

  it("rejects a file that still has Себестоимость", async () => {
    const buf = await workbook([
      [...header, "Себестоимость"],
      ["Москва", "495", "1", "0.5"],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(false);
  });

  it("rejects plus, spaces and a fraction in ABC", async () => {
    const buf = await workbook([
      header,
      ["А", "+7495", "1"],
      ["Б", "7 495", "1"],
      ["В", 12.5, "1"],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details).toHaveLength(3);
    expect(result.details.every((line) => line.includes("ABC"))).toBe(true);
  });

  it("rejects a text price with more than 6 fractional digits", async () => {
    const buf = await workbook([header, ["Москва", "495", "1.23456789"]]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details[0]).toMatch(/Цена/);
  });

  it("keeps a float that only has binary noise", async () => {
    const buf = await workbook([header, ["Москва", "495", 1.15]]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.price).toBe("1.15");
  });

  it("rejects a header-only sheet", async () => {
    const result = await parseTariffXlsx(await workbook([header]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details[0]).toMatch(/нет строк/);
  });

  it("stops after 30 row errors", async () => {
    const rows: unknown[][] = [header];
    for (let i = 0; i < TARIFF_MAX_ERRORS + 5; i++) {
      rows.push(["Москва", "abc", "1"]);
    }
    const result = await parseTariffXlsx(await workbook(rows));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details).toHaveLength(TARIFF_MAX_ERRORS + 1);
    expect(result.details.at(-1)).toMatch(/остановлен/);
  });

  it("rejects a corrupt buffer", async () => {
    const result = await parseTariffXlsx(Buffer.from("not-xlsx"));
    expect(result.ok).toBe(false);
  });
});

describe("formatTariffDecimal", () => {
  it("strips scale zeros and signed zero", () => {
    expect(formatTariffDecimal("1.500000")).toBe("1.5");
    expect(formatTariffDecimal("-0.000000")).toBe("0");
    expect(formatTariffDecimal("10.000000")).toBe("10");
  });
});

describe("sanitizeTariffFilename", () => {
  it("drops control characters and caps length", () => {
    expect(sanitizeTariffFilename(" a\u0000b.xlsx ")).toBe("ab.xlsx");
    expect(sanitizeTariffFilename("")).toBe("tariffs.xlsx");
    expect(sanitizeTariffFilename("x".repeat(300)).length).toBe(255);
  });
});
