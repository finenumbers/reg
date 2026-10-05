import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { writeResolvedEnrichedXlsx } from "@/modules/enrich/xlsx-writer";
import {
  DETAIL_HEADERS,
  MISSING_BILLING_LABEL,
  TRAFFIC_HEADERS,
} from "@/modules/enrich/types";
import type { ResolvedEnrichedRow } from "@/modules/enrich/types";
import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";
import { PARKING_DST } from "@/modules/stats/classify";
import {
  XLSX_BILLING_FONT_ARGB,
  XLSX_CALL_ERROR_FILL,
  XLSX_CHECK_FILL,
  XLSX_FAILED_FILL,
  XLSX_PARKING_KNOWN_FILL,
  XLSX_PHANTOM_FILL,
} from "@/modules/enrich/xlsx-styles";
import {
  readXlsxEntry,
  xlsxCellXfs,
  xlsxFillRgbs,
  xlsxSheetStyleIds,
} from "@/modules/enrich/xlsx-ooxml";

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
    await expect(writeWorkbook()).resolves.toEqual(["Август 2026 года", "Детализация"]);
  });

  it("splits call time into Дата and Время on both sheets", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "xlsx-writer-"));
    const jsonlPath = path.join(dir, "rows.jsonl");
    const outputPath = path.join(dir, "out.xlsx");
    await writeFile(jsonlPath, `${JSON.stringify(ROW)}\n`, "utf8");
    await writeResolvedEnrichedXlsx({
      jsonlPath,
      outputPath,
      rowCount: 1,
      trafficSheetName: "Август 2026 года",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
    const traffic = workbook.getWorksheet("Август 2026 года")!;
    const detail = workbook.getWorksheet("Детализация")!;
    expect(TRAFFIC_HEADERS.map((_, i) => traffic.getRow(1).getCell(i + 1).value)).toEqual(
      [...TRAFFIC_HEADERS],
    );
    expect(DETAIL_HEADERS.map((_, i) => detail.getRow(1).getCell(i + 1).value)).toEqual([
      ...DETAIL_HEADERS,
    ]);
    expect(traffic.getRow(2).getCell(1).value).toBe("01.08.2026");
    expect(traffic.getRow(2).getCell(2).value).toBe("12:00:00");
    expect(traffic.getRow(2).getCell(3).value).toBe(CALL_CATEGORY.internal);
    expect(traffic.getRow(2).getCell(4).value).toBe(CALL_STATUS.success);
    expect(detail.getRow(2).getCell(1).value).toBe("01.08.2026");
    expect(detail.getRow(2).getCell(2).value).toBe("12:00:00");
    expect(detail.getRow(2).getCell(3).value).toBe(CALL_CATEGORY.internal);
    expect(detail.getRow(2).getCell(4).value).toBe(CALL_STATUS.success);
  });

  it("writes redirect from the initiating device on both sheets", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "xlsx-writer-"));
    const jsonlPath = path.join(dir, "rows.jsonl");
    const outputPath = path.join(dir, "out.xlsx");
    await writeFile(
      jsonlPath,
      `${JSON.stringify({ ...ROW, initDevice: "Redirect_1", termDevice: "Service_Check", cause: "Class4, 40 - Gateway Is Invalid" })}\n`,
      "utf8",
    );
    await writeResolvedEnrichedXlsx({
      jsonlPath,
      outputPath,
      rowCount: 1,
      trafficSheetName: "Август 2026 года",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
    expect(workbook.getWorksheet("Август 2026 года")!.getRow(2).getCell(3).value).toBe(
      CALL_CATEGORY.redirect,
    );
    expect(workbook.getWorksheet("Детализация")!.getRow(2).getCell(3).value).toBe(
      CALL_CATEGORY.redirect,
    );
  });

  it("fills phantom, route-error, parking, check, and failed rows on every column of both sheets", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "xlsx-writer-"));
    const jsonlPath = path.join(dir, "rows.jsonl");
    const outputPath = path.join(dir, "out.xlsx");
    const phantom: ResolvedEnrichedRow = {
      ...ROW,
      aNumber: "79001112233",
      bNumber: "79004445566",
      termDevice: PARKING_DST,
      sideA: MISSING_BILLING_LABEL,
      sideB: MISSING_BILLING_LABEL,
      elapsedTime: "",
    };
    const errorRow: ResolvedEnrichedRow = {
      ...ROW,
      aNumber: "",
      bNumber: "",
      cause: "Class4, 40 - Gateway Is Invalid",
      elapsedTime: "",
    };
    const parkingKnown: ResolvedEnrichedRow = {
      ...ROW,
      termDevice: PARKING_DST,
      sideA: "Офис",
      sideB: MISSING_BILLING_LABEL,
    };
    const failed: ResolvedEnrichedRow = {
      ...ROW,
      seconds: 0,
      elapsedTime: "",
      sideA: "Офис",
      sideB: MISSING_BILLING_LABEL,
    };
    const zeroSeconds: ResolvedEnrichedRow = {
      ...ROW,
      seconds: 0,
      sideA: "Офис",
      sideB: MISSING_BILLING_LABEL,
    };
    await writeFile(
      jsonlPath,
      `${JSON.stringify(phantom)}\n${JSON.stringify(errorRow)}\n${JSON.stringify(ROW)}\n${JSON.stringify(parkingKnown)}\n${JSON.stringify(failed)}\n${JSON.stringify(zeroSeconds)}\n`,
      "utf8",
    );
    await writeResolvedEnrichedXlsx({
      jsonlPath,
      outputPath,
      rowCount: 6,
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
    const errorArgb = (XLSX_CALL_ERROR_FILL as ExcelJS.FillPattern).fgColor?.argb;
    const parkingArgb = (XLSX_PARKING_KNOWN_FILL as ExcelJS.FillPattern).fgColor?.argb;
    const failedArgb = (XLSX_FAILED_FILL as ExcelJS.FillPattern).fgColor?.argb;

    for (const sheet of [traffic!, detail!]) {
      const lastCol = sheet.columnCount;
      expect(lastCol).toBeGreaterThan(8);
      for (let c = 1; c <= lastCol; c++) {
        expect(argb(sheet.getRow(2).getCell(c))).toBe(phantomArgb);
        expect(argb(sheet.getRow(3).getCell(c))).toBe(errorArgb);
        expect(argb(sheet.getRow(4).getCell(c))).toBeUndefined();
        expect(argb(sheet.getRow(5).getCell(c))).toBe(parkingArgb);
        expect(argb(sheet.getRow(6).getCell(c))).toBe(failedArgb);
        expect(argb(sheet.getRow(7).getCell(c))).toBeUndefined();
        expect(sheet.getRow(2).getCell(c).border?.top).toBeTruthy();
      }
    }

    expect(traffic!.getRow(2).getCell(6).value).toBe(MISSING_BILLING_LABEL);
    expect(String(traffic!.getRow(2).getCell(6).value).startsWith("'")).toBe(false);
    expect(traffic!.getRow(2).getCell(6).font?.color?.argb).toBe(XLSX_BILLING_FONT_ARGB);
    expect(traffic!.getRow(2).getCell(8).font?.color?.argb).toBe(XLSX_BILLING_FONT_ARGB);
    expect(detail!.getRow(2).getCell(6).font?.color?.argb).toBe(XLSX_BILLING_FONT_ARGB);
    expect(detail!.getRow(2).getCell(10).font?.color?.argb).toBe(XLSX_BILLING_FONT_ARGB);
    expect(traffic!.getRow(5).getCell(8).font?.color?.argb).toBe(XLSX_BILLING_FONT_ARGB);
    expect(traffic!.getRow(2).getCell(3).value).toBe(CALL_CATEGORY.phantom);
    expect(traffic!.getRow(2).getCell(4).value).toBe(CALL_STATUS.failed);
    expect(traffic!.getRow(3).getCell(3).value).toBe(CALL_CATEGORY.routeError);
    expect(traffic!.getRow(5).getCell(3).value).toBe(CALL_CATEGORY.outgoingParking);
    expect(traffic!.getRow(6).getCell(3).value).toBe(CALL_CATEGORY.outgoing);
    expect(traffic!.getRow(6).getCell(4).value).toBe(CALL_STATUS.failed);
    expect(traffic!.getRow(7).getCell(4).value).toBe(CALL_STATUS.success);
  });

  it("writes solid fill xfs that Excel can apply (OOXML, not ExcelJS getter)", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "xlsx-writer-"));
    const jsonlPath = path.join(dir, "rows.jsonl");
    const outputPath = path.join(dir, "out.xlsx");
    const phantom: ResolvedEnrichedRow = {
      ...ROW,
      termDevice: PARKING_DST,
      sideA: MISSING_BILLING_LABEL,
      sideB: MISSING_BILLING_LABEL,
    };
    const errorRow: ResolvedEnrichedRow = {
      ...ROW,
      cause: "Class4, 1 - Unregistered IP Address",
    };
    const parkingKnown: ResolvedEnrichedRow = {
      ...ROW,
      termDevice: PARKING_DST,
      sideA: "Офис",
      sideB: MISSING_BILLING_LABEL,
    };
    const failed: ResolvedEnrichedRow = {
      ...ROW,
      elapsedTime: "",
      sideA: "Офис",
      sideB: MISSING_BILLING_LABEL,
    };
    const check: ResolvedEnrichedRow = {
      ...ROW,
      termDevice: "Service_Check",
      elapsedTime: "",
    };
    await writeFile(
      jsonlPath,
      `${JSON.stringify(phantom)}\n${JSON.stringify(errorRow)}\n${JSON.stringify(ROW)}\n${JSON.stringify(parkingKnown)}\n${JSON.stringify(failed)}\n${JSON.stringify(check)}\n`,
      "utf8",
    );
    await writeResolvedEnrichedXlsx({
      jsonlPath,
      outputPath,
      rowCount: 6,
      trafficSheetName: "Август 2026 года",
      includeDetail: false,
    });

    const stylesXml = readXlsxEntry(outputPath, "xl/styles.xml");
    const sheetXml = readXlsxEntry(outputPath, "xl/worksheets/sheet1.xml");
    const rgbs = xlsxFillRgbs(stylesXml);
    expect(rgbs).toEqual(
      expect.arrayContaining([
        "FFBBF7D0",
        "FFFECACA",
        "FFBFDBFE",
        "FFE5E7EB",
        (XLSX_CHECK_FILL as ExcelJS.FillPattern).fgColor?.argb,
      ]),
    );

    const xfs = xlsxCellXfs(stylesXml);
    expect(xfs.some((xf) => xf.applyFill && xf.fillId >= 2)).toBe(true);

    const used = xlsxSheetStyleIds(sheetXml)
      .map((id) => xfs[id])
      .filter(Boolean);
    expect(used.some((xf) => xf.applyFill && xf.fillId >= 2)).toBe(true);
  });
});
