/**
 * Stream two-sheet enriched XLSX from JSONL + lookup maps.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import ExcelJS from "exceljs";
import { XLSX_UNREGISTERED_FILL } from "@/lib/xlsx-export";
import { csvTimeToExcelSerial } from "@/modules/enrich/dates";
import { guardExcelText } from "@/modules/enrich/formula-guard";
import {
  DETAIL_HEADERS,
  DETAIL_WIDTHS,
  TRAFFIC_HEADERS,
  TRAFFIC_WIDTHS,
  billableMinutes,
  descriptionOrMissing,
  pstnOrMissing,
  type CdrJsonlRow,
} from "@/modules/enrich/types";
import type { PstnFields } from "@/modules/pstn/types";
import type { GeoFields } from "@/modules/geoip/types";
import {
  detailBodyRole,
  detailHeaderRole,
  detailRedCols,
  trafficBodyRole,
  trafficHeaderRole,
  trafficRedCols,
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

function applyStyle(
  cell: ExcelJS.Cell,
  role: BorderRole,
  opts: { header?: boolean; date?: boolean; red?: boolean },
): void {
  cell.border = bordersFor(role);
  if (opts.header) {
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }
  if (opts.date) {
    cell.numFmt = "m/d/yy h:mm";
  }
  if (opts.red) {
    cell.fill = XLSX_UNREGISTERED_FILL;
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

async function eachJsonlRow(
  jsonlPath: string,
  visit: (row: CdrJsonlRow, index: number) => void,
): Promise<void> {
  const input = createReadStream(jsonlPath, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Infinity });
  let index = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    visit(JSON.parse(line) as CdrJsonlRow, index);
    index += 1;
  }
}

export async function writeEnrichedXlsx(opts: {
  jsonlPath: string;
  outputPath: string;
  rowCount: number;
  descriptions: Map<string, string>;
  pstn: Map<string, PstnFields>;
  geo: Map<string, GeoFields>;
}): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: opts.outputPath,
    useStyles: true,
    useSharedStrings: false,
  });

  const traffic = workbook.addWorksheet("Трафик");
  TRAFFIC_WIDTHS.forEach((width, i) => {
    traffic.getColumn(i + 1).width = width;
  });
  const trafficHeader = traffic.addRow([...TRAFFIC_HEADERS]);
  trafficHeader.eachCell((cell, colNumber) => {
    applyStyle(cell, trafficHeaderRole(colNumber - 1), { header: true });
  });
  trafficHeader.commit();

  await eachJsonlRow(opts.jsonlPath, (row, index) => {
    const last = index === opts.rowCount - 1;
    const sideA = descriptionOrMissing(opts.descriptions.get(row.aNumber));
    const sideB = descriptionOrMissing(opts.descriptions.get(row.bNumber));
    const red = trafficRedCols(
      sideA === "Нет данных",
      sideB === "Нет данных",
    );
    const serial = csvTimeToExcelSerial(row.time);
    const values: Array<string | number> = [
      serial ?? text(row.time),
      text(row.aNumber),
      text(sideA),
      text(row.bNumber),
      text(sideB),
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
        date: colNumber === 1 && serial != null,
        red: red.has(colNumber - 1),
      });
    });
    excelRow.commit();
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

  await eachJsonlRow(opts.jsonlPath, (row, index) => {
    const last = index === opts.rowCount - 1;
    const sideA = descriptionOrMissing(opts.descriptions.get(row.aNumber));
    const sideB = descriptionOrMissing(opts.descriptions.get(row.bNumber));
    const pstnA = pstnOrMissing(opts.pstn.get(row.aNumber));
    const pstnB = pstnOrMissing(opts.pstn.get(row.bNumber));
    const geoA = geoBits(row.initIp ? opts.geo.get(row.initIp) : undefined);
    const geoB = geoBits(row.termIp ? opts.geo.get(row.termIp) : undefined);
    const red = detailRedCols(pstnA.missing, pstnB.missing);
    const serial = csvTimeToExcelSerial(row.time);
    const values: Array<string | number> = [
      serial ?? text(row.time),
      text(row.aNumber),
      text(sideA),
      text(pstnA.operator),
      text(pstnA.geography),
      text(row.bNumber),
      text(sideB),
      text(pstnB.operator),
      text(pstnB.geography),
      row.seconds,
      text(row.initDevice),
      text(row.termDevice),
      text(row.dialObject),
      text(row.cause),
      text(row.initEndpoint),
      text(geoA.country),
      text(geoA.city),
      text(geoA.isp),
      text(row.termEndpoint),
      text(geoB.country),
      text(geoB.city),
      text(geoB.isp),
    ];
    const excelRow = detail.addRow(values);
    excelRow.eachCell((cell, colNumber) => {
      applyStyle(cell, detailBodyRole(colNumber - 1, last), {
        date: colNumber === 1 && serial != null,
        red: red.has(colNumber - 1),
      });
    });
    excelRow.commit();
  });
  detail.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: opts.rowCount + 1, column: DETAIL_HEADERS.length },
  };
  await detail.commit();
  await workbook.commit();
}
