/**
 * Stream two-sheet enriched XLSX from JSONL + lookup maps.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import ExcelJS from "exceljs";
import {
  XLSX_BILLING_MISS_FILL,
  XLSX_UNREGISTERED_FILL,
} from "@/lib/xlsx-export";
import { csvTimeToDisplay } from "@/modules/enrich/dates";
import { excelPhoneValue } from "@/modules/enrich/excel-phone";
import { guardExcelText } from "@/modules/enrich/formula-guard";
import {
  DETAIL_HEADERS,
  DETAIL_WIDTHS,
  MISSING_BILLING_LABEL,
  MISSING_PSTN_LABEL,
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
  detailFill,
  detailHeaderRole,
  trafficBodyRole,
  trafficFill,
  trafficHeaderRole,
  type BorderRole,
  type FillRole,
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

function applyStyle(
  cell: ExcelJS.Cell,
  role: BorderRole,
  opts: { header?: boolean; fill?: FillRole; phone?: boolean },
): void {
  cell.border = bordersFor(role);
  if (opts.header) {
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }
  if (opts.phone) {
    cell.numFmt = "0";
  }
  if (opts.fill === "red") {
    cell.fill = XLSX_UNREGISTERED_FILL;
  } else if (opts.fill === "yellow") {
    cell.fill = XLSX_BILLING_MISS_FILL;
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

function pstnMissing(operator: string, geography: string): boolean {
  return operator === MISSING_PSTN_LABEL || geography === MISSING_PSTN_LABEL;
}

const PROGRESS_EVERY = 250;

async function writeResolvedSheets(opts: {
  trafficSheetName: string;
  outputPath: string;
  rowCount: number;
  onProgress?: (info: XlsxSheetProgress) => void;
  eachRow: (
    visit: (row: ResolvedEnrichedRow, index: number) => void,
  ) => Promise<void>;
}): Promise<void> {
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
    const values: Array<string | number> = [
      text(csvTimeToDisplay(row.time)),
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
    excelRow.eachCell((cell, colNumber) => {
      applyStyle(cell, trafficBodyRole(colNumber - 1, last), {
        phone:
          (colNumber === 2 || colNumber === 4) && typeof cell.value === "number",
        fill: trafficFill(
          colNumber - 1,
          row.sideA === MISSING_BILLING_LABEL,
          row.sideB === MISSING_BILLING_LABEL,
          pstnMissing(row.operatorA, row.geographyA),
          pstnMissing(row.operatorB, row.geographyB),
        ),
      });
    });
    excelRow.commit();
    report("traffic", index + 1, last);
  });
  traffic.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: opts.rowCount + 1, column: TRAFFIC_HEADERS.length },
  };
  await traffic.commit();

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
    const values: Array<string | number> = [
      text(csvTimeToDisplay(row.time)),
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
    excelRow.eachCell((cell, colNumber) => {
      applyStyle(cell, detailBodyRole(colNumber - 1, last), {
        phone:
          (colNumber === 2 || colNumber === 6) && typeof cell.value === "number",
        fill: detailFill(
          colNumber - 1,
          row.sideA === MISSING_BILLING_LABEL,
          row.sideB === MISSING_BILLING_LABEL,
          pstnMissing(row.operatorA, row.geographyA),
          pstnMissing(row.operatorB, row.geographyB),
        ),
      });
    });
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
  onProgress?: (info: XlsxSheetProgress) => void;
}): Promise<void> {
  await writeResolvedSheets({
    trafficSheetName: opts.trafficSheetName,
    outputPath: opts.outputPath,
    rowCount: opts.rowCount,
    onProgress: opts.onProgress,
    eachRow: (visit) => eachJsonlRow<ResolvedEnrichedRow>(opts.jsonlPath, visit),
  });
}
