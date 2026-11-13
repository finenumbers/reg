/**
 * One styled sheet written to disk. ExcelJS streaming records column widths
 * on the first row commit, so cell text is spooled first and the sheet is
 * opened only after each column's longest value is known.
 *
 * Borders and the header filter cover the filled rectangle. Style objects are
 * shared so a large sheet does not keep a copy per cell.
 */

import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import ExcelJS from "exceljs";
import {
  cappedCodePointLength,
  EXCEL_COLUMN_MEASURE_CAP,
  excelColumnWidth,
} from "@/lib/xlsx-export";
import { guardExcelText } from "@/modules/enrich/formula-guard";

/** Excel worksheet max data rows, leaving the header row. */
export const EXCEL_SHEET_MAX_DATA_ROWS = 1_048_575;

const SPOOL_BATCH_ROWS = 2_000;
const REPLAY_YIELD_ROWS = 40;

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
  /** Write the text unchanged. A formula prefix would change the stored value. */
  plain?: boolean;
  bold?: boolean;
  align?: "left" | "right";
};

export type StreamCell = string | number | null;

type SpoolCell = string | number;

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

function cellValue(column: StreamColumn, raw: StreamCell): SpoolCell {
  if (raw == null || raw === "") return "";
  if (typeof raw === "number" && Number.isFinite(raw) && !column.text) return raw;
  const text = String(raw);
  return column.plain ? text : guardExcelText(text);
}

function encodeBatch(rows: readonly SpoolCell[][]): string {
  let out = "";
  for (const row of rows) out += `${JSON.stringify(row)}\n`;
  return out;
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export type StreamingWorkbook = {
  writeRow: (raw: readonly StreamCell[]) => Promise<void>;
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
  const spoolPath = `${opts.filePath}.rows`;
  const columnCount = opts.columns.length;
  const maxLens = opts.columns.map((column) => cappedCodePointLength(column.header));
  let batch: SpoolCell[][] = [];
  let chain: Promise<void> = Promise.resolve();
  let spool: WriteStream | null = null;
  let xlsxStream: ReturnType<typeof createWriteStream> | null = null;
  let failed: Error | null = null;
  let written = 0;
  let phase: "open" | "finishing" | "closed" = "open";

  const noteLength = (index: number, value: SpoolCell) => {
    if ((maxLens[index] ?? 0) >= EXCEL_COLUMN_MEASURE_CAP) return;
    const len = cappedCodePointLength(String(value));
    if (len > (maxLens[index] ?? 0)) maxLens[index] = len;
  };

  const ensureSpool = (): WriteStream => {
    if (spool) return spool;
    const stream = createWriteStream(spoolPath, { flags: "w" });
    stream.on("error", (error: Error) => {
      if (!failed) failed = error;
    });
    spool = stream;
    return stream;
  };

  const writeChunk = (payload: string): Promise<void> => {
    if (failed) return Promise.reject(failed);
    const stream = ensureSpool();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finishWrite = (error?: Error | null) => {
        if (settled) return;
        settled = true;
        stream.off("error", onError);
        if (error) {
          failed = error;
          reject(error);
          return;
        }
        resolve();
      };
      const onError = (error: Error) => finishWrite(error);
      stream.once("error", onError);
      stream.write(payload, (error) => finishWrite(error));
    });
  };

  const enqueue = (rows: SpoolCell[][]) => {
    const payload = encodeBatch(rows);
    chain = chain.then(() => writeChunk(payload));
    return chain;
  };

  const endSpool = (): Promise<void> => {
    if (!spool) return Promise.resolve();
    const stream = spool;
    spool = null;
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (error?: Error | null) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      stream.once("error", done);
      stream.end(() => done());
    });
  };

  const cleanup = async () => {
    spool?.destroy();
    spool = null;
    xlsxStream?.destroy();
    xlsxStream = null;
    batch = [];
    await unlink(spoolPath).catch(() => undefined);
  };

  const styleDataCell = (cell: ExcelJS.Cell, spec: StreamColumn) => {
    cell.border = BORDER;
    cell.font = spec.bold ? BODY_BOLD_FONT : BODY_FONT;
    cell.alignment = spec.align === "right" ? RIGHT_ALIGN : LEFT_ALIGN;
    if (spec.text) cell.numFmt = "@";
  };

  const replay = async () => {
    xlsxStream = createWriteStream(opts.filePath);
    xlsxStream.on("error", () => {
      // Destroy on cancel closes the file. The job deletes the directory.
    });
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: xlsxStream,
      useStyles: true,
      useSharedStrings: false,
    });
    const widths = maxLens.map((len) => excelColumnWidth(len ?? 0));
    let sheetIndex = 1;
    let dataRowsOnSheet = 0;
    let replayed = 0;
    let worksheet: ExcelJS.Worksheet | null = null;

    const finishSheet = () => {
      if (!worksheet) return;
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, dataRowsOnSheet + 1), column: columnCount },
      };
      worksheet.commit();
      worksheet = null;
    };

    const beginSheet = () => {
      worksheet = workbook.addWorksheet(sheetTitle(opts.sheetName, sheetIndex));
      for (let i = 0; i < columnCount; i++) {
        worksheet.getColumn(i + 1).width = widths[i] ?? excelColumnWidth(0);
      }
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
      dataRowsOnSheet = 0;
    };

    const writeDataRow = async (values: readonly SpoolCell[]) => {
      if (opts.signal?.aborted) throw new TableExportCancelled();
      if (dataRowsOnSheet >= EXCEL_SHEET_MAX_DATA_ROWS) {
        finishSheet();
        sheetIndex += 1;
        beginSheet();
      }
      const added = worksheet!.addRow([...values]);
      for (let col = 1; col <= columnCount; col++) {
        styleDataCell(added.getCell(col), opts.columns[col - 1]!);
      }
      added.commit();
      dataRowsOnSheet += 1;
      replayed += 1;
      if (replayed % REPLAY_YIELD_ROWS === 0) await yieldEventLoop();
    };

    beginSheet();
    if (written > 0) {
      const reader = createInterface({
        input: createReadStream(spoolPath),
        crlfDelay: Infinity,
      });
      try {
        for await (const line of reader) {
          if (!line) continue;
          const values = JSON.parse(line) as SpoolCell[];
          await writeDataRow(values);
        }
      } finally {
        reader.close();
      }
    }
    finishSheet();
    await workbook.commit();
  };

  return {
    writeRow(raw: readonly StreamCell[]) {
      if (phase !== "open") return Promise.resolve();
      if (opts.signal?.aborted || failed instanceof TableExportCancelled) {
        return Promise.reject(new TableExportCancelled());
      }
      if (failed) return Promise.reject(failed);
      const values = opts.columns.map((column, index) =>
        cellValue(column, raw[index] ?? null),
      );
      for (let i = 0; i < columnCount; i++) noteLength(i, values[i] ?? "");
      batch.push(values);
      written += 1;
      opts.onRows?.(written);
      if (batch.length < SPOOL_BATCH_ROWS) return Promise.resolve();
      const rows = batch;
      batch = [];
      return enqueue(rows);
    },
    async finish() {
      if (phase !== "open") return written;
      phase = "finishing";
      try {
        await chain;
        if (failed) throw failed;
        if (opts.signal?.aborted) throw new TableExportCancelled();
        if (batch.length > 0) {
          const rows = batch;
          batch = [];
          await writeChunk(encodeBatch(rows));
        }
        await endSpool();
        await replay();
        await unlink(spoolPath).catch(() => undefined);
        phase = "closed";
        return written;
      } catch (error) {
        phase = "closed";
        await cleanup();
        throw error;
      }
    },
    abort() {
      if (phase === "closed") return;
      phase = "closed";
      failed = new TableExportCancelled();
      void cleanup();
    },
  };
}
