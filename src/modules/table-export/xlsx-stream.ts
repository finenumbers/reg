/**
 * One styled sheet streamed to disk. Borders and the header filter cover the
 * filled rectangle. Style objects are shared so a large sheet does not keep a
 * copy per cell.
 */

import { createWriteStream } from "node:fs";
import ExcelJS from "exceljs";
import { guardExcelText } from "@/modules/enrich/formula-guard";

/** Excel worksheet max data rows, leaving the header row. */
export const EXCEL_SHEET_MAX_DATA_ROWS = 1_048_575;

const WIDTH_CAP = 80;
const WIDTH_PAD = 2;
const WIDTH_MIN = 8;

const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FF000000" } };
const BORDER: Partial<ExcelJS.Borders> = {
  top: THIN,
  left: THIN,
  bottom: THIN,
  right: THIN,
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: true,
  color: { argb: "FF000000" },
};
const BODY_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: false,
  color: { argb: "FF000000" },
};
const BODY_BOLD_FONT: Partial<ExcelJS.Font> = { ...BODY_FONT, bold: true };
const HEADER_ALIGN: Partial<ExcelJS.Alignment> = {
  horizontal: "center",
  vertical: "middle",
  wrapText: false,
};
const LEFT_ALIGN: Partial<ExcelJS.Alignment> = {
  horizontal: "left",
  vertical: "middle",
  wrapText: false,
};
const RIGHT_ALIGN: Partial<ExcelJS.Alignment> = {
  horizontal: "right",
  vertical: "middle",
  wrapText: false,
};

export type StreamColumn = {
  header: string;
  /** Keep digit-like values as text so Excel does not drop a leading zero. */
  text?: boolean;
  bold?: boolean;
  align?: "left" | "right";
};

export type StreamCell = string | number | null;

export class TableExportCancelled extends Error {
  constructor() {
    super("Экспорт отменён");
    this.name = "TableExportCancelled";
  }
}

function sheetTitle(base: string, index: number): string {
  const name = index === 1 ? base : `${base} ${index}`;
  return name.slice(0, 31);
}

function displayLength(value: string | number): number {
  return [...String(value)].length;
}

function cellValue(column: StreamColumn, raw: StreamCell): string | number {
  if (raw == null || raw === "") return "";
  if (typeof raw === "number" && Number.isFinite(raw) && !column.text) return raw;
  return guardExcelText(String(raw));
}

function columnWidth(header: string, maxLen: number): number {
  return Math.min(
    WIDTH_CAP,
    Math.max(WIDTH_MIN, Math.max(displayLength(header), maxLen) + WIDTH_PAD),
  );
}

export type StreamingWorkbook = {
  writeRow: (raw: readonly StreamCell[]) => void;
  finish: () => Promise<number>;
  abort: () => void;
};

export function openStreamingWorkbook(opts: {
  filePath: string;
  sheetName: string;
  columns: readonly StreamColumn[];
  signal?: AbortSignal;
  onRows?: (written: number) => void;
}): StreamingWorkbook {
  const stream = createWriteStream(opts.filePath);
  stream.on("error", () => {
    // Destroy on cancel closes the file. The job deletes the directory.
  });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream,
    useStyles: true,
    useSharedStrings: false,
  });
  const columnCount = opts.columns.length;
  let sheetIndex = 1;
  let dataRowsOnSheet = 0;
  let written = 0;
  let maxLens = opts.columns.map((column) => displayLength(column.header));
  let worksheet: ExcelJS.Worksheet | null = null;
  let closed = false;

  const beginSheet = () => {
    worksheet = workbook.addWorksheet(sheetTitle(opts.sheetName, sheetIndex));
    maxLens = opts.columns.map((column) => displayLength(column.header));
    dataRowsOnSheet = 0;
    const header = worksheet.addRow(opts.columns.map((column) => column.header));
    header.font = HEADER_FONT;
    header.alignment = HEADER_ALIGN;
    for (let col = 1; col <= columnCount; col++) {
      const cell = header.getCell(col);
      cell.border = BORDER;
      cell.font = HEADER_FONT;
      cell.alignment = HEADER_ALIGN;
    }
    header.commit();
  };

  const finishSheet = () => {
    if (!worksheet) return;
    for (let i = 0; i < columnCount; i++) {
      worksheet.getColumn(i + 1).width = columnWidth(
        opts.columns[i]!.header,
        maxLens[i] ?? 0,
      );
    }
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, dataRowsOnSheet + 1), column: columnCount },
    };
    worksheet.commit();
    worksheet = null;
  };

  beginSheet();

  return {
    writeRow(raw: readonly StreamCell[]) {
      if (closed) return;
      if (opts.signal?.aborted) throw new TableExportCancelled();
      if (dataRowsOnSheet >= EXCEL_SHEET_MAX_DATA_ROWS) {
        finishSheet();
        sheetIndex += 1;
        beginSheet();
      }
      const values = opts.columns.map((column, index) =>
        cellValue(column, raw[index] ?? null),
      );
      for (let i = 0; i < columnCount; i++) {
        const len = displayLength(values[i] ?? "");
        if (len > (maxLens[i] ?? 0)) maxLens[i] = len;
      }
      const added = worksheet!.addRow(values);
      for (let col = 1; col <= columnCount; col++) {
        const spec = opts.columns[col - 1]!;
        const cell = added.getCell(col);
        cell.border = BORDER;
        cell.font = spec.bold ? BODY_BOLD_FONT : BODY_FONT;
        cell.alignment = spec.align === "right" ? RIGHT_ALIGN : LEFT_ALIGN;
        if (spec.text) cell.numFmt = "@";
      }
      added.commit();
      dataRowsOnSheet += 1;
      written += 1;
      opts.onRows?.(written);
    },
    async finish() {
      if (closed) return written;
      closed = true;
      try {
        finishSheet();
        await workbook.commit();
        return written;
      } catch (error) {
        stream.destroy();
        throw error;
      }
    },
    abort() {
      if (closed) return;
      closed = true;
      stream.destroy();
    },
  };
}
