import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  MARKING_HEADERS,
  parseMarkingXlsx,
  sanitizeMarkingFilename,
} from "@/modules/marking/parse-xlsx";

async function workbook(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Маркировка и МАВ");
  rows.forEach((cells, index) => {
    const row = ws.getRow(index + 1);
    cells.forEach((cell, column) => {
      row.getCell(column + 1).value = cell as ExcelJS.CellValue;
    });
  });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

const header = [...MARKING_HEADERS];
const emptyTail = ["", "", "", "", "", "", "", ""];

describe("parseMarkingXlsx", () => {
  it("keeps a numeric phone, skips an empty row, and leaves blank operator cells empty", async () => {
    const numeric = new ExcelJS.Workbook();
    const sheet = numeric.addWorksheet("Лист");
    header.forEach((name, index) => {
      sheet.getRow(1).getCell(index + 1).value = name;
    });
    const row = sheet.getRow(2);
    row.getCell(1).value = " Клиент А ";
    row.getCell(2).value = 70000000001;
    row.getCell(3).value = "AO Client";
    row.getCell(4).value = "Клиент";
    sheet.getRow(3).getCell(1).value = "";
    const result = await parseMarkingXlsx(Buffer.from(await numeric.xlsx.writeBuffer()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      {
        sortIndex: 0,
        client: "Клиент А",
        phoneNumber: "70000000001",
        labelMts: "AO Client",
        labelMegafon: "Клиент",
        labelBeeline: null,
        labelT2: null,
        mavMts: null,
        mavMegafon: null,
        mavBeeline: null,
        mavT2: null,
      },
    ]);
  });

  it("accepts a text phone and a whole number in a marking cell", async () => {
    const result = await parseMarkingXlsx(
      await workbook([
        header,
        ["Клиент А", "070000000001", "", "", "", "", 10, ...emptyTail.slice(1)],
        [],
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({
      phoneNumber: "070000000001",
      mavMts: "10",
      labelMts: null,
    });
  });

  it("rejects a scrambled header and an extra column", async () => {
    const scrambled = await parseMarkingXlsx(
      await workbook([[...header].reverse(), ["Клиент А", "70000000001", ...emptyTail]]),
    );
    expect(scrambled.ok).toBe(false);
    if (scrambled.ok) return;
    expect(scrambled.details[0]).toMatch(/в этом порядке/);

    const extra = await parseMarkingXlsx(
      await workbook([
        [...header, "Лишнее"],
        ["Клиент А", "70000000001", ...emptyTail, "x"],
      ]),
    );
    expect(extra.ok).toBe(false);
  });

  it("keeps a short phone, a spaced phone, and an empty client", async () => {
    const result = await parseMarkingXlsx(
      await workbook([
        header,
        ["", "123", ...emptyTail],
        ["Клиент А", "7 000 000 0001", ...emptyTail],
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.phoneNumber)).toEqual(["123", "7 000 000 0001"]);
    expect(result.rows[0]?.client).toBe("");
  });

  it("rejects a fraction phone", async () => {
    const bad = await parseMarkingXlsx(
      await workbook([header, ["Клиент А", 70000000001.5, ...emptyTail]]),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.details[0]).toMatch(/Номер/);
  });

  it("rejects a repeated phone before any row is kept", async () => {
    const result = await parseMarkingXlsx(
      await workbook([
        header,
        ["Клиент А", "70000000001", ...emptyTail],
        ["Клиент Б", "70000000001", ...emptyTail],
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details).toEqual(["Строка 3: «Номер» повторяет строку 2"]);
  });

  it("rejects a date, an unsafe number, text past 200 characters, and an empty sheet", async () => {
    const dated = new ExcelJS.Workbook();
    const sheet = dated.addWorksheet("Маркировка");
    header.forEach((name, index) => {
      sheet.getRow(1).getCell(index + 1).value = name;
    });
    const row = sheet.getRow(2);
    row.getCell(1).value = "Клиент А";
    row.getCell(2).value = "70000000001";
    row.getCell(3).value = new Date(Date.UTC(2024, 0, 2));
    const dateResult = await parseMarkingXlsx(
      Buffer.from(await dated.xlsx.writeBuffer()),
    );
    expect(dateResult.ok).toBe(false);
    if (dateResult.ok) return;
    expect(dateResult.details[0]).toMatch(/Маркировка МТС/);

    const exponent = await parseMarkingXlsx(
      await workbook([header, ["Клиент А", "7.0000000001E10", ...emptyTail]]),
    );
    expect(exponent.ok).toBe(true);
    if (!exponent.ok) return;
    expect(exponent.rows[0]?.phoneNumber).toBe("7.0000000001E10");

    const unsafe = await parseMarkingXlsx(
      await workbook([header, ["Клиент А", 1e21, ...emptyTail]]),
    );
    expect(unsafe.ok).toBe(false);

    const long = await parseMarkingXlsx(
      await workbook([header, ["К".repeat(201), "70000000001", ...emptyTail]]),
    );
    expect(long.ok).toBe(false);
    if (long.ok) return;
    expect(long.details[0]).toMatch(/200/);

    const empty = await parseMarkingXlsx(await workbook([header, []]));
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.details).toEqual(["В файле нет строк с данными"]);
  });

  it("stops after 30 errors", async () => {
    const rows: unknown[][] = [header];
    for (let i = 0; i < 40; i++) rows.push(["Клиент", "1".repeat(201), ...emptyTail]);
    const result = await parseMarkingXlsx(await workbook(rows));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details.at(-1)).toBe("Разбор остановлен после 30 ошибок");
    expect(result.details).toHaveLength(31);
  });

  it("sanitizes a filename", () => {
    expect(sanitizeMarkingFilename("")).toBe("marking.xlsx");
    expect(sanitizeMarkingFilename("a\u0000b.xlsx")).toBe("ab.xlsx");
    expect(sanitizeMarkingFilename("я".repeat(300))).toHaveLength(255);
  });
});

const realFile = process.env.MARKING_XLSX;

describe.skipIf(!realFile)("parseMarkingXlsx operator workbook", () => {
  it("accepts the operator file without embedding its values", async () => {
    const result = await parseMarkingXlsx(readFileSync(realFile!));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.phoneNumber.length).toBeGreaterThan(0);
      expect(row.phoneNumber.length).toBeLessThanOrEqual(200);
    }
  });
});
