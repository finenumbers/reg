/**
 * Shared ExcelJS helpers for XLSX downloads.
 */

import ExcelJS from "exceljs";

export { formatExportTimestamp } from "@/lib/format-display-time";

/** Light red close to UI destructive/10. */
export const XLSX_UNREGISTERED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFEE2E2" },
};

/** Same thin border as softswitch export header row. */
const XLSX_THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

/** Softswitch / phones export header style. */
const XLSX_HEADER_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: true,
  color: { argb: "FF000000" },
};

const XLSX_BODY_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: false,
  color: { argb: "FF000000" },
};

const XLSX_HEADER_ALIGNMENT: Partial<ExcelJS.Alignment> = {
  horizontal: "center",
  vertical: "middle",
};

export type ReplaceSheetStyleCellCtx = {
  /** `-1` for header row, `0..` for data rows. */
  rowIndex: number;
  /** 0-based column index. */
  colIndex: number;
  cell: ExcelJS.Cell;
};

export async function workbookToBuffer(
  workbook: ExcelJS.Workbook,
): Promise<Buffer> {
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Excel refuses a column wider than this. */
export const EXCEL_COLUMN_WIDTH_MAX = 255;
export const EXCEL_COLUMN_WIDTH_MIN = 8;
export const EXCEL_COLUMN_WIDTH_PAD = 2;
/** Past this length the width stays at the Excel maximum. */
export const EXCEL_COLUMN_MEASURE_CAP = EXCEL_COLUMN_WIDTH_MAX - EXCEL_COLUMN_WIDTH_PAD;

/** Code points, stopping at `cap`, so a long cell does not allocate a character array. */
export function cappedCodePointLength(
  value: string,
  cap: number = EXCEL_COLUMN_MEASURE_CAP,
): number {
  let count = 0;
  for (let i = 0; i < value.length; ) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) i += 2;
    else i += 1;
    count += 1;
    if (count >= cap) return cap;
  }
  return count;
}

/** Width from the longest code-point count. Pad 2, floor 8, ceiling 255. */
export function excelColumnWidth(maxCodePoints: number): number {
  return Math.min(
    EXCEL_COLUMN_WIDTH_MAX,
    Math.max(EXCEL_COLUMN_WIDTH_MIN, maxCodePoints + EXCEL_COLUMN_WIDTH_PAD),
  );
}

/** Excel column width from max string length (header + cells). */
export function columnWidthForValues(
  header: string,
  columnValues: readonly string[],
): number {
  let maxLen = cappedCodePointLength(header);
  if (maxLen >= EXCEL_COLUMN_MEASURE_CAP) return excelColumnWidth(maxLen);
  for (const value of columnValues) {
    const len = cappedCodePointLength(String(value ?? ""));
    if (len > maxLen) maxLen = len;
    if (maxLen >= EXCEL_COLUMN_MEASURE_CAP) break;
  }
  return excelColumnWidth(maxLen);
}

function autofitSheetColumns(
  sheet: ExcelJS.Worksheet,
  headers: readonly string[],
  rows: string[][],
): void {
  for (let c = 0; c < headers.length; c++) {
    const colValues = rows.map((r) => r[c] ?? "");
    sheet.getColumn(c + 1).width = columnWidthForValues(
      headers[c]!,
      colValues,
    );
  }
}

function styleHeaderCell(cell: ExcelJS.Cell, value: string): void {
  cell.value = value;
  cell.font = { ...XLSX_HEADER_FONT };
  cell.alignment = { ...XLSX_HEADER_ALIGNMENT };
  cell.border = { ...XLSX_THIN_BORDER };
}

function styleBodyCell(
  cell: ExcelJS.Cell,
  opts?: { fill?: ExcelJS.Fill },
): void {
  cell.font = { ...XLSX_BODY_FONT };
  cell.border = { ...XLSX_THIN_BORDER };
  if (opts?.fill) cell.fill = opts.fill;
}

/** Replace data rows (from row 2) keeping / rewriting header row 1. */
export function replaceSheetData(
  sheet: ExcelJS.Worksheet,
  headers: readonly string[],
  rows: string[][],
  opts?: {
    highlightRow?: (rowIndex: number, values: string[]) => boolean;
    highlightFill?: ExcelJS.Fill;
    styleCell?: (ctx: ReplaceSheetStyleCellCtx) => void;
  },
): void {
  // ExcelJS spliceRows(2, N) is unreliable on worksheets loaded from .xlsx
  // templates (e.g. phones-export Groups sheet) — old rows survive and
  // addRow appends duplicates. Delete from the end one row at a time.
  for (let i = sheet.rowCount; i >= 2; i--) {
    sheet.spliceRows(i, 1);
  }

  const headerRow = sheet.getRow(1);
  for (let c = 1; c <= headers.length; c++) {
    const cell = headerRow.getCell(c);
    styleHeaderCell(cell, headers[c - 1]!);
    opts?.styleCell?.({ rowIndex: -1, colIndex: c - 1, cell });
  }
  headerRow.commit();

  for (let i = 0; i < rows.length; i++) {
    const values = rows[i]!;
    const excelRow = sheet.addRow(values);
    const highlight =
      Boolean(opts?.highlightRow?.(i, values)) && opts?.highlightFill;
    for (let c = 1; c <= headers.length; c++) {
      const cell = excelRow.getCell(c);
      styleBodyCell(cell, {
        fill: highlight ? opts.highlightFill : undefined,
      });
      opts?.styleCell?.({ rowIndex: i, colIndex: c - 1, cell });
    }
  }

  autofitSheetColumns(sheet, headers, rows);

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: {
      row: Math.max(1, rows.length + 1),
      column: headers.length,
    },
  };
}

/** New workbook with the same table chrome as phones export. */
export function createSimpleWorkbook(opts: {
  sheetName: string;
  headers: readonly string[];
  rows: string[][];
  styleCell?: (ctx: ReplaceSheetStyleCellCtx) => void;
  highlightRow?: (rowIndex: number, values: string[]) => boolean;
  highlightFill?: ExcelJS.Fill;
}): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(opts.sheetName);
  // Seed empty header row so replaceSheetData can rewrite it with styles.
  sheet.addRow(opts.headers.map(() => ""));
  replaceSheetData(sheet, opts.headers, opts.rows, {
    styleCell: opts.styleCell,
    highlightRow: opts.highlightRow,
    highlightFill: opts.highlightFill,
  });
  return workbook;
}

export function xlsxContentDisposition(filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
