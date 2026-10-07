/**
 * Stream two-sheet enriched XLSX from JSONL + lookup maps.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import ExcelJS from "exceljs";
import { excelPhoneValue } from "@/modules/enrich/excel-phone";
import { xlsxCdrDateTimeCells } from "@/modules/traffic/cdr-date-parts";
import { guardExcelText } from "@/modules/enrich/formula-guard";
import { classifyCallCategory, classifyExportStatus } from "@/modules/traffic/call-class";
import { rateCdrCall, type TariffRateLookup } from "@/modules/traffic/cdr-tariff";
import { cdrRowTone } from "@/modules/traffic/row-tone";
import {
  DETAIL_HEADERS,
  DETAIL_WIDTHS,
  MISSING_BILLING_LABEL,
  TRAFFIC_HEADERS,
  TRAFFIC_WIDTHS,
  billableMinutes,
  descriptionOrMissing,
  pstnOrMissing,
  type CdrJsonlRow,
  type ResolvedEnrichedRow,
} from "@/modules/enrich/types";
import type { PstnFields } from "@/modules/pstn/types";
import type { GeoFields } from "@/modules/geoip/types";
import {
  detailBodyRole,
  detailHeaderRole,
  trafficBodyRole,
  trafficHeaderRole,
  xlsxMissFontRole,
  XLSX_BILLING_FONT_ARGB,
  XLSX_CALL_ERROR_FILL,
  XLSX_CHECK_FILL,
  XLSX_FAILED_FILL,
  XLSX_PARKING_KNOWN_FILL,
  XLSX_PHANTOM_FILL,
  XLSX_VERIFY_FILL,
  XLSX_PSTN_FONT_ARGB,
  type BorderRole,
} from "@/modules/enrich/xlsx-styles";

const THIN: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: "FF000000" },
};
const MEDIUM: Partial<ExcelJS.Border> = {
  style: "medium",
  color: { argb: "FF000000" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: true,
};

function bordersFor(role: BorderRole): Partial<ExcelJS.Borders> {
  switch (role) {
    case "plain":
      return { top: THIN, left: THIN, bottom: THIN, right: THIN };
    case "noRight":
      return { top: THIN, left: THIN, bottom: THIN };
    case "noLeft":
      return { top: THIN, right: THIN, bottom: THIN };
    case "groupStart":
      return { top: THIN, left: MEDIUM, bottom: THIN, right: THIN };
    case "groupMid":
      return { top: THIN, left: THIN, bottom: THIN, right: THIN };
    case "groupEnd":
      return { top: THIN, left: THIN, bottom: THIN, right: MEDIUM };
    case "groupLastStart":
      return { top: THIN, left: MEDIUM, bottom: MEDIUM, right: THIN };
    case "groupLastMid":
      return { top: THIN, left: THIN, bottom: MEDIUM, right: THIN };
    case "groupLastEnd":
      return { top: THIN, left: THIN, bottom: MEDIUM, right: MEDIUM };
    case "headerPlain":
      return { top: THIN, left: THIN, bottom: THIN, right: THIN };
    case "headerNoRight":
      return { top: THIN, left: THIN, bottom: THIN };
    case "headerNoLeft":
      return { top: THIN, right: THIN, bottom: THIN };
    case "headerGroupStart":
      return { top: MEDIUM, left: MEDIUM, bottom: THIN, right: THIN };
    case "headerGroupMid":
      return { top: MEDIUM, left: THIN, bottom: THIN, right: THIN };
    case "headerGroupEnd":
      return { top: MEDIUM, left: THIN, bottom: THIN, right: MEDIUM };
    default:
      return { top: THIN, left: THIN, bottom: THIN, right: THIN };
  }
}

const BODY_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
};

function applyMissFont(cell: ExcelJS.Cell, billingSide: boolean): void {
  if (typeof cell.value !== "string") return;
  if (billingSide && cell.value === MISSING_BILLING_LABEL) {
    cell.font = { ...BODY_FONT, color: { argb: XLSX_BILLING_FONT_ARGB } };
    return;
  }
  if (xlsxMissFontRole(cell.value) === "red") {
    cell.font = { ...BODY_FONT, color: { argb: XLSX_PSTN_FONT_ARGB } };
  }
}

function applyStyle(
  cell: ExcelJS.Cell,
  role: BorderRole,
  opts: { header?: boolean; phone?: boolean; money?: boolean; billingSide?: boolean },
): void {
  cell.border = bordersFor(role);
  if (opts.header) {
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }
  if (opts.phone) {
    cell.numFmt = "0";
  }
  if (opts.money) {
    cell.numFmt = "#,##0.00";
  }
  if (!opts.header) applyMissFont(cell, Boolean(opts.billingSide));
}

function categoryOf(
  row: Pick<
    ResolvedEnrichedRow,
    | "sideA"
    | "sideB"
    | "termDevice"
    | "initDevice"
    | "cause"
    | "dialObject"
    | "aNumber"
    | "bNumber"
  >,
  rates: readonly TariffRateLookup[],
): string {
  return classifyCallCategory(
    row.sideA,
    row.sideB,
    row.termDevice,
    row.initDevice,
    row.cause,
    row.dialObject,
    row.aNumber,
    row.bNumber,
    rates,
  );
}

function statusOf(
  row: Pick<
    ResolvedEnrichedRow,
    | "elapsedTime"
    | "sideA"
    | "sideB"
    | "termDevice"
    | "initDevice"
    | "cause"
    | "dialObject"
  >,
): string {
  return classifyExportStatus(
    row.elapsedTime,
    row.sideA,
    row.sideB,
    row.termDevice,
    row.initDevice,
    row.cause,
    row.dialObject,
  );
}

function rowFill(
  row: ResolvedEnrichedRow,
  rates: readonly TariffRateLookup[],
): ExcelJS.Fill | undefined {
  const tone = cdrRowTone(categoryOf(row, rates), statusOf(row));
  if (tone === "phantom") return XLSX_PHANTOM_FILL;
  if (tone === "call_error") return XLSX_CALL_ERROR_FILL;
  if (tone === "verify") return XLSX_VERIFY_FILL;
  if (tone === "parking") return XLSX_PARKING_KNOWN_FILL;
  if (tone === "check") return XLSX_CHECK_FILL;
  if (tone === "failed") return XLSX_FAILED_FILL;
  return undefined;
}

function styleBodyRow(
  excelRow: ExcelJS.Row,
  colCount: number,
  roleFor: (colIndex0: number) => BorderRole,
  phoneCols: ReadonlySet<number>,
  sideCols: ReadonlySet<number>,
  fill: ExcelJS.Fill | undefined,
  boldCols: ReadonlySet<number>,
  moneyCols: ReadonlySet<number>,
): void {
  for (let c = 1; c <= colCount; c++) {
    const cell = excelRow.getCell(c);
    applyStyle(cell, roleFor(c - 1), {
      phone: phoneCols.has(c) && typeof cell.value === "number",
      money: moneyCols.has(c) && typeof cell.value === "number",
      billingSide: sideCols.has(c),
    });
    if (boldCols.has(c)) {
      cell.font = { ...BODY_FONT, ...(cell.font ?? {}), bold: true };
    }
    if (fill) cell.fill = fill;
  }
}

function text(value: string): string {
  return guardExcelText(value);
}

/** Billing-miss hyphen is a known sentinel, not a formula. */
function sideText(value: string): string {
  if (value === MISSING_BILLING_LABEL) return value;
  return text(value);
}

function geoBits(geo: GeoFields | undefined): {
  country: string;
  city: string;
  isp: string;
} {
  return {
    country: geo?.countryIso ?? "",
    city: geo?.city ?? "",
    isp: geo?.isp ?? "",
  };
}

export type XlsxSheetProgress = {
  sheet: "traffic" | "detail";
  current: number;
  total: number;
};

async function eachJsonlRow<T>(
  jsonlPath: string,
  visit: (row: T, index: number) => void,
): Promise<void> {
  const input = createReadStream(jsonlPath, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Infinity });
  let index = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    visit(JSON.parse(line) as T, index);
    index += 1;
  }
}

function excelMoney(raw: string | undefined): number | "" {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : "";
}

function rateExportRow(
  row: Pick<
    ResolvedEnrichedRow,
    | "sideA"
    | "sideB"
    | "initDevice"
    | "termDevice"
    | "dialObject"
    | "cause"
    | "elapsedTime"
    | "seconds"
    | "aNumber"
    | "bNumber"
  >,
  rates: readonly TariffRateLookup[],
): ReturnType<typeof rateCdrCall> {
  const elapsed =
    row.elapsedTime !== undefined
      ? row.elapsedTime
      : String(Math.max(0, Math.trunc(row.seconds)) * 1000);
  return rateCdrCall({
    category: categoryOf(row, rates),
    status: statusOf(row),
    billDnis: row.bNumber,
    elapsedTime: elapsed,
    rates,
  });
}

function resolveFromMaps(
  row: CdrJsonlRow,
  maps: {
    descriptions: Map<string, string>;
    pstn: Map<string, PstnFields>;
    geo: Map<string, GeoFields>;
    rates: readonly TariffRateLookup[];
  },
): ResolvedEnrichedRow {
  const sideA = descriptionOrMissing(maps.descriptions.get(row.aNumber));
  const sideB = descriptionOrMissing(maps.descriptions.get(row.bNumber));
  const pstnA = pstnOrMissing(maps.pstn.get(row.aNumber));
  const pstnB = pstnOrMissing(maps.pstn.get(row.bNumber));
  const geoA = geoBits(row.initIp ? maps.geo.get(row.initIp) : undefined);
  const geoB = geoBits(row.termIp ? maps.geo.get(row.termIp) : undefined);
  const rated = rateExportRow(
    {
      sideA,
      sideB,
      initDevice: row.initDevice,
      termDevice: row.termDevice,
      dialObject: row.dialObject,
      cause: row.cause,
      seconds: row.seconds,
      aNumber: row.aNumber,
      bNumber: row.bNumber,
    },
    maps.rates,
  );
  return {
    time: row.time,
    aNumber: row.aNumber,
    bNumber: row.bNumber,
    seconds: row.seconds,
    initDevice: row.initDevice,
    termDevice: row.termDevice,
    dialObject: row.dialObject,
    cause: row.cause,
    initEndpoint: row.initEndpoint,
    termEndpoint: row.termEndpoint,
    sideA,
    sideB,
    operatorA: pstnA.operator,
    geographyA: pstnA.geography,
    operatorB: pstnB.operator,
    geographyB: pstnB.geography,
    countryA: geoA.country,
    cityA: geoA.city,
    providerA: geoA.isp,
    countryB: geoB.country,
    cityB: geoB.city,
    providerB: geoB.isp,
    tariffDirection: rated.direction,
    tariffPrice: rated.price,
    tariffCharge: rated.charge,
  };
}

const PROGRESS_EVERY = 250;
/** 1-based Excel columns: А-номер and В-номер, after Категория and Статус. */
const TRAFFIC_PHONE_COLS = new Set([5, 7]);
const DETAIL_PHONE_COLS = new Set([5, 9]);
const TRAFFIC_CHARGE_COL = TRAFFIC_HEADERS.indexOf("Стоимость") + 1;
const TRAFFIC_BOLD_COLS = new Set([...TRAFFIC_PHONE_COLS, TRAFFIC_CHARGE_COL]);
const TRAFFIC_MONEY_COLS = new Set(
  (["Цена", "Стоимость"] as const).map((header) => TRAFFIC_HEADERS.indexOf(header) + 1),
);
/** 1-based «Сторона A/B» columns. Blue billing-miss text stays on these only. */
const TRAFFIC_SIDE_COLS = new Set([6, 8]);
const DETAIL_SIDE_COLS = new Set([6, 10]);

function callClassCells(
  row: ResolvedEnrichedRow,
  rates: readonly TariffRateLookup[],
): [string, string] {
  return [text(categoryOf(row, rates)), text(statusOf(row))];
}

async function writeResolvedSheets(opts: {
  trafficSheetName: string;
  outputPath: string;
  rowCount: number;
  includeDetail?: boolean;
  rates?: readonly TariffRateLookup[];
  onProgress?: (info: XlsxSheetProgress) => void;
  eachRow: (visit: (row: ResolvedEnrichedRow, index: number) => void) => Promise<void>;
}): Promise<void> {
  const includeDetail = opts.includeDetail !== false;
  const rates = opts.rates ?? [];
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: opts.outputPath,
    useStyles: true,
    useSharedStrings: false,
  });

  const report = (sheet: XlsxSheetProgress["sheet"], current: number, last: boolean) => {
    if (!opts.onProgress) return;
    if (last || current === 0 || current % PROGRESS_EVERY === 0) {
      opts.onProgress({ sheet, current, total: opts.rowCount });
    }
  };

  const traffic = workbook.addWorksheet(opts.trafficSheetName);
  TRAFFIC_WIDTHS.forEach((width, i) => {
    traffic.getColumn(i + 1).width = width;
  });
  const trafficHeader = traffic.addRow([...TRAFFIC_HEADERS]);
  trafficHeader.eachCell((cell, colNumber) => {
    applyStyle(cell, trafficHeaderRole(colNumber - 1), { header: true });
  });
  trafficHeader.commit();

  await opts.eachRow((row, index) => {
    const last = index === opts.rowCount - 1;
    const aPhone = excelPhoneValue(row.aNumber);
    const bPhone = excelPhoneValue(row.bNumber);
    const callAt = xlsxCdrDateTimeCells(row.time);
    const values: Array<string | number> = [
      text(callAt.day),
      text(callAt.time),
      ...callClassCells(row, rates),
      aPhone,
      sideText(row.sideA),
      bPhone,
      sideText(row.sideB),
      text(row.tariffDirection ?? ""),
      row.seconds,
      billableMinutes(row.seconds),
      excelMoney(row.tariffPrice),
      excelMoney(row.tariffCharge),
      text(row.initDevice),
      text(row.termDevice),
      text(row.dialObject),
      text(row.cause),
    ];
    const excelRow = traffic.addRow(values);
    styleBodyRow(
      excelRow,
      TRAFFIC_HEADERS.length,
      (col) => trafficBodyRole(col, last),
      TRAFFIC_PHONE_COLS,
      TRAFFIC_SIDE_COLS,
      rowFill(row, rates),
      TRAFFIC_BOLD_COLS,
      TRAFFIC_MONEY_COLS,
    );
    excelRow.commit();
    report("traffic", index + 1, last);
  });
  traffic.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: opts.rowCount + 1, column: TRAFFIC_HEADERS.length },
  };
  await traffic.commit();

  if (!includeDetail) {
    await workbook.commit();
    return;
  }

  const detail = workbook.addWorksheet("Детализация");
  DETAIL_WIDTHS.forEach((width, i) => {
    detail.getColumn(i + 1).width = width;
  });
  const detailHeader = detail.addRow([...DETAIL_HEADERS]);
  detailHeader.eachCell((cell, colNumber) => {
    applyStyle(cell, detailHeaderRole(colNumber - 1), { header: true });
  });
  detailHeader.commit();

  await opts.eachRow((row, index) => {
    const last = index === opts.rowCount - 1;
    const aPhone = excelPhoneValue(row.aNumber);
    const bPhone = excelPhoneValue(row.bNumber);
    const callAt = xlsxCdrDateTimeCells(row.time);
    const values: Array<string | number> = [
      text(callAt.day),
      text(callAt.time),
      ...callClassCells(row, rates),
      aPhone,
      sideText(row.sideA),
      text(row.operatorA),
      text(row.geographyA),
      bPhone,
      sideText(row.sideB),
      text(row.operatorB),
      text(row.geographyB),
      row.seconds,
      text(row.initDevice),
      text(row.termDevice),
      text(row.dialObject),
      text(row.cause),
      text(row.initEndpoint),
      text(row.countryA),
      text(row.cityA),
      text(row.providerA),
      text(row.termEndpoint),
      text(row.countryB),
      text(row.cityB),
      text(row.providerB),
    ];
    const excelRow = detail.addRow(values);
    styleBodyRow(
      excelRow,
      DETAIL_HEADERS.length,
      (col) => detailBodyRole(col, last),
      DETAIL_PHONE_COLS,
      DETAIL_SIDE_COLS,
      rowFill(row, rates),
      DETAIL_PHONE_COLS,
      new Set(),
    );
    excelRow.commit();
    report("detail", index + 1, last);
  });
  detail.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: opts.rowCount + 1, column: DETAIL_HEADERS.length },
  };
  await detail.commit();
  await workbook.commit();
}

export async function writeEnrichedXlsx(opts: {
  jsonlPath: string;
  outputPath: string;
  rowCount: number;
  descriptions: Map<string, string>;
  pstn: Map<string, PstnFields>;
  geo: Map<string, GeoFields>;
  rates?: readonly TariffRateLookup[];
  trafficSheetName?: string;
  onProgress?: (info: XlsxSheetProgress) => void;
}): Promise<void> {
  await writeResolvedSheets({
    trafficSheetName: opts.trafficSheetName ?? "Трафик",
    outputPath: opts.outputPath,
    rowCount: opts.rowCount,
    rates: opts.rates ?? [],
    onProgress: opts.onProgress,
    eachRow: (visit) =>
      eachJsonlRow<CdrJsonlRow>(opts.jsonlPath, (row, index) => {
        visit(resolveFromMaps(row, { ...opts, rates: opts.rates ?? [] }), index);
      }),
  });
}

export async function writeResolvedEnrichedXlsx(opts: {
  jsonlPath: string;
  outputPath: string;
  rowCount: number;
  trafficSheetName: string;
  includeDetail?: boolean;
  rates?: readonly TariffRateLookup[];
  onProgress?: (info: XlsxSheetProgress) => void;
}): Promise<void> {
  await writeResolvedSheets({
    trafficSheetName: opts.trafficSheetName,
    outputPath: opts.outputPath,
    rowCount: opts.rowCount,
    includeDetail: opts.includeDetail,
    rates: opts.rates ?? [],
    onProgress: opts.onProgress,
    eachRow: (visit) => eachJsonlRow<ResolvedEnrichedRow>(opts.jsonlPath, visit),
  });
}
