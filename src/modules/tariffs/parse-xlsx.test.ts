import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  formatTariffDecimal,
  parseStoredNumbering,
  parseTariffXlsx,
  sanitizeTariffFilename,
  TARIFF_HEADERS,
  TARIFF_MAX_ERRORS,
} from "@/modules/tariffs/parse-xlsx";
import { parseStoredDigitLengths } from "@/modules/traffic/tariff-match";

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
      ["Москва", "0495", "", "", "1,50"],
      [],
      ["Казань", "843", "", "", "10"],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      {
        sortIndex: 0,
        direction: "Москва",
        abc: "0495",
        digitLengths: null,
        numbering: null,
        price: "1.5",
      },
      {
        sortIndex: 1,
        direction: "Казань",
        abc: "843",
        digitLengths: null,
        numbering: null,
        price: "10",
      },
    ]);
  });

  it("accepts columns in any order and a numeric ABC cell", async () => {
    const buf = await workbook([
      ["Цена", "ABC", "Направления", "Разрядность", "Нумерация"],
      ["1 234,50", 495, "Москва", "", 7],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({
      sortIndex: 0,
      direction: "Москва",
      abc: "495",
      digitLengths: null,
      numbering: [7],
      price: "1234.5",
    });
  });

  it("stores a numeric direction as text and allows zero and negative money", async () => {
    const buf = await workbook([
      header,
      [100, "812", "", "", 0],
      ["Скидка", "812", "", "", -0.5],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({
      direction: "100",
      abc: "812",
      digitLengths: null,
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
      ["Москва", "495", "", "1", "0.5"],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(false);
  });

  it("rejects plus, spaces and a fraction in ABC", async () => {
    const buf = await workbook([
      header,
      ["А", "+7495", "", "", "1"],
      ["Б", "7 495", "", "", "1"],
      ["В", 12.5, "", "", "1"],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details).toHaveLength(3);
    expect(result.details.every((line) => line.includes("ABC"))).toBe(true);
  });

  it("rejects a text price with more than 6 fractional digits", async () => {
    const buf = await workbook([header, ["Москва", "495", "", "", "1.23456789"]]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details[0]).toMatch(/Цена/);
  });

  it("keeps a float that only has binary noise", async () => {
    const buf = await workbook([header, ["Москва", "495", "", "", 1.15]]);
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
      rows.push(["Москва", "abc", "", "", "1"]);
    }
    const result = await parseTariffXlsx(await workbook(rows));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details).toHaveLength(TARIFF_MAX_ERRORS + 1);
    expect(result.details.at(-1)).toMatch(/остановлен/);
  });

  it("stores a length list and ignores the cell on every ABC that starts with 7", async () => {
    const buf = await workbook([
      header,
      ["Казахстан", 77, "11/12", "", 20],
      ["Беларусь", "375", "12 / 13", "", 45],
      ["Армения", "374", 11, "", 22],
      ["Германия", "49", "", "", 12],
      ["г. Москва", "7495", "мусор", "", 2],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => [row.abc, row.digitLengths])).toEqual([
      ["77", null],
      ["375", [12, 13]],
      ["374", [11]],
      ["49", null],
      ["7495", null],
    ]);
  });

  it("rejects a date, a repeated length, and an ABC on 7 past 11 digits", async () => {
    const missing = await parseTariffXlsx(
      await workbook([
        ["Направления", "ABC", "Цена"],
        ["Москва", "7495", "1"],
      ]),
    );
    expect(missing.ok).toBe(false);

    const bad = await parseTariffXlsx(
      await workbook([
        header,
        ["Беларусь", "375", 11.5, "", 1],
        ["Беларусь", "375", 9, "", 1],
        ["Беларусь", "375", "12/12", "", 1],
        ["Длинный", "375291234567", 10, "", 1],
        ["Казахстан", "771234567890", "", "", 1],
      ]),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.details).toHaveLength(5);
    expect(bad.details[0]).toMatch(/Разрядность/);
    expect(bad.details[1]).toMatch(/Разрядность/);
    expect(bad.details[2]).toMatch(/Разрядность/);
    expect(bad.details[3]).toMatch(/не короче кода ABC/);
    expect(bad.details[4]).toMatch(/на 7 не длиннее 11/);

    const dated = new ExcelJS.Workbook();
    const sheet = dated.addWorksheet("Тарифы");
    header.forEach((name, index) => {
      sheet.getRow(1).getCell(index + 1).value = name;
    });
    const row = sheet.getRow(2);
    row.getCell(1).value = "Беларусь";
    row.getCell(2).value = "375";
    row.getCell(3).value = new Date(Date.UTC(2024, 11, 13));
    row.getCell(3).numFmt = "m/d";
    row.getCell(5).value = 45;
    const dateResult = await parseTariffXlsx(Buffer.from(await dated.xlsx.writeBuffer()));
    expect(dateResult.ok).toBe(false);
    if (dateResult.ok) return;
    expect(dateResult.details[0]).toMatch(/текстовый формат/);
  });

  it("stores numbering outside the ABC, including a code on 7", async () => {
    const buf = await workbook([
      header,
      ["Москва", "7495", "мусор", 0, "2"],
      ["Беларусь", "375", "12/13", "8/7", "1"],
      ["Пусто", "49", "", "", "1"],
    ]);
    const result = await parseTariffXlsx(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => [row.abc, row.digitLengths, row.numbering])).toEqual([
      ["7495", null, [0]],
      ["375", [12, 13], [8, 7]],
      ["49", null, null],
    ]);
  });

  it("rejects numbering outside 0–14, a leading zero, a repeat, and text", async () => {
    const bad = await parseTariffXlsx(
      await workbook([
        header,
        ["А", "375", "", 15, 1],
        ["Б", "375", "", "00", 1],
        ["В", "375", "", "07", 1],
        ["Г", "375", "", "7/7", 1],
        ["Д", "375", "", "город", 1],
      ]),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.details).toHaveLength(5);
    expect(bad.details.every((line) => line.includes("Нумерация"))).toBe(true);
  });

  it("rejects a numbering date and a row that only fills that cell", async () => {
    const dated = new ExcelJS.Workbook();
    const sheet = dated.addWorksheet("Тарифы");
    header.forEach((name, index) => {
      sheet.getRow(1).getCell(index + 1).value = name;
    });
    const row = sheet.getRow(2);
    row.getCell(1).value = "Беларусь";
    row.getCell(2).value = "375";
    row.getCell(4).value = new Date(Date.UTC(2024, 11, 13));
    row.getCell(4).numFmt = "m/d";
    row.getCell(5).value = 1;
    const dateResult = await parseTariffXlsx(Buffer.from(await dated.xlsx.writeBuffer()));
    expect(dateResult.ok).toBe(false);
    if (dateResult.ok) return;
    expect(dateResult.details[0]).toMatch(/Нумерация/);
    expect(dateResult.details[0]).toMatch(/текстовый формат/);

    const onlyNumbering = await parseTariffXlsx(
      await workbook([header, ["", "", "", "7", ""]]),
    );
    expect(onlyNumbering.ok).toBe(false);
    if (onlyNumbering.ok) return;
    expect(onlyNumbering.details.some((line) => line.includes("Направления"))).toBe(true);
    expect(onlyNumbering.details.some((line) => line.includes("Нумерация"))).toBe(false);
  });

  it("keeps a total length of 7 as no match and reads numbering 7", () => {
    expect(parseStoredDigitLengths("7")).toEqual([]);
    expect(parseStoredNumbering("7")).toEqual([7]);
    expect(parseStoredNumbering("0/14")).toEqual([0, 14]);
    expect(parseStoredNumbering("8/7")).toEqual([8, 7]);
    expect(parseStoredNumbering(null)).toBeNull();
    expect(parseStoredNumbering("")).toBeNull();
    expect(parseStoredNumbering("15")).toBeNull();
    expect(parseStoredNumbering("07")).toBeNull();
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
