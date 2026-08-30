/**
 * Stream two-sheet enriched XLSX from JSONL + lookup maps.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import ExcelJS from "exceljs";
import { excelPhoneValue } from "@/modules/enrich/excel-phone";
import { xlsxCdrDateTimeCells } from "@/modules/traffic/cdr-date-parts";
import { guardExcelText } from "@/modules/enrich/formula-guard";
import { classifyCdrRow } from "@/modules/enrich/row-flags";
import {
  DETAIL_HEADERS,
  DETAIL_WIDTHS,
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
  XLSX_PHANTOM_FILL,
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

function applyMissFont(cell: ExcelJS.Cell): void {
  if (typeof cell.value !== "string") return;
  const role = xlsxMissFontRole(cell.value);
  if (role === "blue") {
    cell.font = { ...BODY_FONT, color: { argb: XLSX_BILLING_FONT_ARGB } };
  } else if (role === "red") {
    cell.font = { ...BODY_FONT, color: { argb: XLSX_PSTN_FONT_ARGB } };
  }
}

function applyStyle(
  cell: ExcelJS.Cell,
  role: BorderRole,
  opts: { header?: boolean; phone?: boolean },
): void {
  cell.border = bordersFor(role);
  if (opts.header) {
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }
  if (opts.phone) {
    cell.numFmt = "0";
  }
  if (!opts.header) applyMissFont(cell);
}

function rowFill(row: ResolvedEnrichedRow): ExcelJS.Fill | undefined {
  const flag = classifyCdrRow({
    aNumber: row.aNumber,
    bNumber: row.bNumber,
    sideA: row.sideA,
    sideB: row.sideB,
  });
  if (flag === "phantom") return XLSX_PHANTOM_FILL;
  if (flag === "call_error") return XLSX_CALL_ERROR_FILL;
  return undefined;
}

function styleBodyRow(
  excelRow: ExcelJS.Row,
  colCount: number,
  roleFor: (colIndex0: number) => BorderRole,
  phoneCols: ReadonlySet<number>,
  fill: ExcelJS.Fill | undefined,
): void {
  for (let c = 1; c <= colCount; c++) {
    const cell = excelRow.getCell(c);
    applyStyle(cell, roleFor(c - 1), {
      phone: phoneCols.has(c) && typeof cell.value === "number",
    });
    if (fill) cell.fill = fill;
  }
}

function text(value: string): string {
  return guardExcelText(value);
}

function geoBits(
  geo: GeoFields | undefined,
): { country: string; city: string; isp: string } {
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

function resolveFromMaps(
  row: CdrJsonlRow,
  maps: {
    descriptions: Map<string, string>;
    pstn: Map<string, PstnFields>;
    geo: Map<string, GeoFields>;
  },
): ResolvedEnrichedRow {
  const sideA = descriptionOrMissing(maps.descriptions.get(row.aNumber));
  const sideB = descriptionOrMissing(maps.descriptions.get(row.bNumber));
  const pstnA = pstnOrMissing(maps.pstn.get(row.aNumber));
  const pstnB = pstnOrMissing(maps.pstn.get(row.bNumber));
  const geoA = geoBits(row.initIp ? maps.geo.get(row.initIp) : undefined);
  const geoB = geoBits(row.termIp ? maps.geo.get(row.termIp) : undefined);
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
  };
}

const PROGRESS_EVERY = 250;
const TRAFFIC_PHONE_COLS = new Set([3, 5]);
const DETAIL_PHONE_COLS = new Set([3, 7]);

async function writeResolvedSheets(opts: {
  trafficSheetName: string;
  outputPath: string;
  rowCount: number;
  includeDetail?: boolean;
  onProgress?: (info: XlsxSheetProgress) => void;
  eachRow: (
    visit: (row: ResolvedEnrichedRow, index: number) => void,
  ) => Promise<void>;
}): Promise<void> {
  const includeDetail = opts.includeDetail !== false;
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: opts.outputPath,
    useStyles: true,
    useSharedStrings: false,
  });

  const report = (
    sheet: XlsxSheetProgress["sheet"],
    current: number,
    last: boolean,
  ) => {
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
      aPhone,
      text(row.sideA),
      bPhone,
      text(row.sideB),
      row.seconds,
      billableMinutes(row.seconds),
      "",
      "",
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
      rowFill(row),
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
      aPhone,
      text(row.sideA),
      text(row.operatorA),
      text(row.geographyA),
      bPhone,
      text(row.sideB),
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
      rowFill(row),
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
  trafficSheetName?: string;
  onProgress?: (info: XlsxSheetProgress) => void;
}): Promise<void> {
  await writeResolvedSheets({
    trafficSheetName: opts.trafficSheetName ?? "Трафик",
    outputPath: opts.outputPath,
    rowCount: opts.rowCount,
    onProgress: opts.onProgress,
    eachRow: (visit) =>
      eachJsonlRow<CdrJsonlRow>(opts.jsonlPath, (row, index) => {
        visit(resolveFromMaps(row, opts), index);
      }),
  });
}

export async function writeResolvedEnrichedXlsx(opts: {
  jsonlPath: string;
  outputPath: string;
  rowCount: number;
  trafficSheetName: string;
  includeDetail?: boolean;
  onProgress?: (info: XlsxSheetProgress) => void;
}): Promise<void> {
  await writeResolvedSheets({
    trafficSheetName: opts.trafficSheetName,
    outputPath: opts.outputPath,
    rowCount: opts.rowCount,
    includeDetail: opts.includeDetail,
    onProgress: opts.onProgress,
    eachRow: (visit) => eachJsonlRow<ResolvedEnrichedRow>(opts.jsonlPath, visit),
  });
}
