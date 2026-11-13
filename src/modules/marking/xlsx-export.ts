/**
 * Marking workbook. The database read finishes before the sheet is built.
 * The phone cell is plain text so a later import matches the screen number.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { createSimpleWorkbook, formatExportTimestamp } from "@/lib/xlsx-export";
import { guardExcelText } from "@/modules/enrich/formula-guard";
import { MarkingRejected } from "@/modules/marking/apply";
import { MARKING_SCREEN_ERROR } from "@/modules/marking/payload";
import { MARKING_HEADERS } from "@/modules/marking/parse-xlsx";
import { markingExportSql } from "@/modules/marking/sql";
import { MARKING_WRITE_TIMEOUT, withMarkingTimeout } from "@/modules/marking/timeout";
import { readRtuScreenGate, requestRtuScreenPublish } from "@/modules/rtu/screen-publish";
import { getDisplayTimezone } from "@/modules/settings";
import {
  EXCEL_SHEET_MAX_DATA_ROWS,
  openStreamingWorkbook,
  type StreamColumn,
} from "@/modules/table-export/xlsx-stream";

const EXPORT_TX_MS = 40_000;
const EXPORT_LIMIT = EXCEL_SHEET_MAX_DATA_ROWS + 1;

export type MarkingExportSource = {
  client: string;
  supplier: string;
  phoneNumber: string;
  labelMts: string | null;
  labelMegafon: string | null;
  labelBeeline: string | null;
  labelT2: string | null;
  mavMts: string | null;
  mavMegafon: string | null;
  mavBeeline: string | null;
  mavT2: string | null;
};

const STREAM_COLUMNS: StreamColumn[] = MARKING_HEADERS.map((header) =>
  header === "Номер" ? { header, text: true, plain: true } : { header },
);

export function markingExportCells(row: MarkingExportSource): string[] {
  return [
    guardExcelText(row.client),
    guardExcelText(row.supplier),
    row.phoneNumber,
    guardExcelText(row.labelMts ?? ""),
    guardExcelText(row.labelMegafon ?? ""),
    guardExcelText(row.labelBeeline ?? ""),
    guardExcelText(row.labelT2 ?? ""),
    guardExcelText(row.mavMts ?? ""),
    guardExcelText(row.mavMegafon ?? ""),
    guardExcelText(row.mavBeeline ?? ""),
    guardExcelText(row.mavT2 ?? ""),
  ];
}

export function buildMarkingExportWorkbook(
  rows: readonly MarkingExportSource[],
): ExcelJS.Workbook {
  const headers = [...MARKING_HEADERS];
  return createSimpleWorkbook({
    sheetName: "Маркировка и МАВ",
    headers,
    rows: rows.map((row) => markingExportCells(row)),
    styleCell: ({ rowIndex, colIndex, cell }) => {
      if (rowIndex < 0) return;
      if (headers[colIndex] === "Номер") cell.numFmt = "@";
    },
  });
}

type ExportQueryRow = {
  number: string;
  client: string | null;
  supplier: string | null;
  label_mts: string | null;
  label_megafon: string | null;
  label_beeline: string | null;
  label_t2: string | null;
  mav_mts: string | null;
  mav_megafon: string | null;
  mav_beeline: string | null;
  mav_t2: string | null;
};

export async function readMarkingExportRows(): Promise<MarkingExportSource[]> {
  const gate = await readRtuScreenGate();
  if (!gate?.published || gate.needsPublish) {
    void requestRtuScreenPublish();
  }
  if (!gate?.published) {
    throw new MarkingRejected(MARKING_SCREEN_ERROR, [MARKING_SCREEN_ERROR]);
  }
  const rows = await withMarkingTimeout(MARKING_WRITE_TIMEOUT, EXPORT_TX_MS, (tx) =>
    tx.$queryRaw<ExportQueryRow[]>(markingExportSql(EXPORT_LIMIT)),
  );
  if (rows.length > EXCEL_SHEET_MAX_DATA_ROWS) {
    throw new Error("Слишком много строк для одного файла XLSX");
  }
  return rows.map((row) => ({
    client: row.client ?? "",
    supplier: row.supplier ?? "",
    phoneNumber: row.number,
    labelMts: row.label_mts,
    labelMegafon: row.label_megafon,
    labelBeeline: row.label_beeline,
    labelT2: row.label_t2,
    mavMts: row.mav_mts,
    mavMegafon: row.mav_megafon,
    mavBeeline: row.mav_beeline,
    mavT2: row.mav_t2,
  }));
}

export async function spoolMarkingWorkbook(
  rows: readonly MarkingExportSource[],
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "marking-"));
  const filePath = path.join(dir, "marking.xlsx");
  try {
    const book = openStreamingWorkbook({
      filePath,
      sheetName: "Маркировка и МАВ",
      columns: STREAM_COLUMNS,
    });
    for (const row of rows) {
      await book.writeRow([
        row.client,
        row.supplier,
        row.phoneNumber,
        row.labelMts ?? "",
        row.labelMegafon ?? "",
        row.labelBeeline ?? "",
        row.labelT2 ?? "",
        row.mavMts ?? "",
        row.mavMegafon ?? "",
        row.mavBeeline ?? "",
        row.mavT2 ?? "",
      ]);
    }
    await book.finish();
    return await readFile(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function buildMarkingExportXlsx(): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const [rows, timeZone] = await Promise.all([
    readMarkingExportRows(),
    getDisplayTimezone(),
  ]);
  const buffer = await spoolMarkingWorkbook(rows);
  return {
    buffer,
    filename: `marking-${formatExportTimestamp(new Date(), timeZone)}.xlsx`,
  };
}
