/**
 * Shared ExcelJS helpers for XLSX downloads.
 */

import ExcelJS from "exceljs";

/** Light red close to UI destructive/10. */
export const XLSX_UNREGISTERED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFEE2E2" },
};

/** Same thin border as softswitch export header row. */
export const XLSX_THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

/** Softswitch / phones export header style. */
export const XLSX_HEADER_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: true,
  color: { argb: "FF000000" },
};

export const XLSX_BODY_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: false,
  color: { argb: "FF000000" },
};

export const XLSX_HEADER_ALIGNMENT: Partial<ExcelJS.Alignment> = {
  horizontal: "center",
  vertical: "middle",
};

export function formatExportTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export async function workbookToBuffer(
  workbook: ExcelJS.Workbook,
): Promise<Buffer> {
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Excel column width from max string length (header + cells). */
export function columnWidthForValues(
  header: string,
  columnValues: readonly string[],
): number {
  let maxLen = [...header].length;
  for (const value of columnValues) {
    const len = [...String(value ?? "")].length;
    if (len > maxLen) maxLen = len;
  }
  // Excel width ≈ character count; pad slightly, clamp
  return Math.min(60, Math.max(8, maxLen + 2));
}

export function autofitSheetColumns(
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
  },
): void {
  const last = sheet.rowCount;
  if (last > 1) {
    sheet.spliceRows(2, last - 1);
  }

  const headerRow = sheet.getRow(1);
  for (let c = 1; c <= headers.length; c++) {
    styleHeaderCell(headerRow.getCell(c), headers[c - 1]!);
  }
  headerRow.commit();

  for (let i = 0; i < rows.length; i++) {
    const values = rows[i]!;
    const excelRow = sheet.addRow(values);
    const highlight =
      Boolean(opts?.highlightRow?.(i, values)) && opts?.highlightFill;
    for (let c = 1; c <= headers.length; c++) {
      styleBodyCell(excelRow.getCell(c), {
        fill: highlight ? opts.highlightFill : undefined,
      });
    }
  }

  autofitSheetColumns(sheet, headers, rows);
}

/** New workbook with the same table chrome as phones export. */
export function createSimpleWorkbook(opts: {
  sheetName: string;
  headers: readonly string[];
  rows: string[][];
}): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(opts.sheetName);
  // Seed empty header row so replaceSheetData can rewrite it with styles.
  sheet.addRow(opts.headers.map(() => ""));
  replaceSheetData(sheet, opts.headers, opts.rows);
  return workbook;
}

export function xlsxContentDisposition(filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
