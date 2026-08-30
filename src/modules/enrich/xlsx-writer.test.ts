import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { writeResolvedEnrichedXlsx } from "@/modules/enrich/xlsx-writer";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import type { ResolvedEnrichedRow } from "@/modules/enrich/types";
import {
  XLSX_CALL_ERROR_FILL,
  XLSX_PHANTOM_FILL,
} from "@/modules/enrich/xlsx-styles";

const ROW: ResolvedEnrichedRow = {
  time: "2026-08-01 12:00:00",
  aNumber: "79001112233",
  bNumber: "79004445566",
  seconds: 12,
  initDevice: "gw-a",
  termDevice: "gw-b",
  dialObject: "dp",
  cause: "16",
  initEndpoint: "1.1.1.1",
  termEndpoint: "2.2.2.2",
  sideA: "A",
  sideB: "B",
  operatorA: "op-a",
  geographyA: "geo-a",
  operatorB: "op-b",
  geographyB: "geo-b",
  countryA: "RU",
  cityA: "Moscow",
  providerA: "isp-a",
  countryB: "RU",
  cityB: "SPb",
  providerB: "isp-b",
};

describe("writeResolvedEnrichedXlsx", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  async function writeWorkbook(includeDetail?: boolean) {
    dir = await mkdtemp(path.join(tmpdir(), "xlsx-writer-"));
    const jsonlPath = path.join(dir, "rows.jsonl");
    const outputPath = path.join(dir, "out.xlsx");
    await writeFile(jsonlPath, `${JSON.stringify(ROW)}\n`, "utf8");
    await writeResolvedEnrichedXlsx({
      jsonlPath,
      outputPath,
      rowCount: 1,
      trafficSheetName: "Август 2026 года",
      includeDetail,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
    return workbook.worksheets.map((sheet) => sheet.name);
  }

  it("writes only the month sheet when includeDetail is false", async () => {
    await expect(writeWorkbook(false)).resolves.toEqual(["Август 2026 года"]);
  });

  it("keeps both sheets by default", async () => {
    await expect(writeWorkbook()).resolves.toEqual([
      "Август 2026 года",
      "Детализация",
    ]);
  });

  it("fills phantom and call-error rows on every column of both sheets", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "xlsx-writer-"));
    const jsonlPath = path.join(dir, "rows.jsonl");
    const outputPath = path.join(dir, "out.xlsx");
    const phantom: ResolvedEnrichedRow = {
      ...ROW,
      aNumber: "79001112233",
      bNumber: "79004445566",
      sideA: MISSING_BILLING_LABEL,
      sideB: MISSING_BILLING_LABEL,
    };
    const errorRow: ResolvedEnrichedRow = {
      ...ROW,
      aNumber: "",
      bNumber: "",
      sideA: MISSING_BILLING_LABEL,
      sideB: MISSING_BILLING_LABEL,
    };
    await writeFile(
      jsonlPath,
      `${JSON.stringify(phantom)}\n${JSON.stringify(errorRow)}\n${JSON.stringify(ROW)}\n`,
      "utf8",
    );
    await writeResolvedEnrichedXlsx({
      jsonlPath,
      outputPath,
      rowCount: 3,
      trafficSheetName: "Август 2026 года",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
    const traffic = workbook.getWorksheet("Август 2026 года");
    const detail = workbook.getWorksheet("Детализация");
    expect(traffic).toBeDefined();
    expect(detail).toBeDefined();

    const argb = (cell: ExcelJS.Cell) => {
      const fill = cell.fill as ExcelJS.FillPattern | undefined;
      return fill?.fgColor?.argb;
    };
    const phantomArgb = (XLSX_PHANTOM_FILL as ExcelJS.FillPattern).fgColor?.argb;
    const errorArgb = (XLSX_CALL_ERROR_FILL as ExcelJS.FillPattern).fgColor
      ?.argb;

    for (const sheet of [traffic!, detail!]) {
      const lastCol = sheet.columnCount;
      expect(lastCol).toBeGreaterThan(8);
      for (let c = 1; c <= lastCol; c++) {
        expect(argb(sheet.getRow(2).getCell(c))).toBe(phantomArgb);
        expect(argb(sheet.getRow(3).getCell(c))).toBe(errorArgb);
        expect(argb(sheet.getRow(4).getCell(c))).toBeUndefined();
        expect(sheet.getRow(2).getCell(c).border?.top).toBeTruthy();
      }
    }
  });
});
