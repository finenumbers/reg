/**
 * Parse the cost-estimate input workbook.
 * Headers: Дата, A-номер, B-номер, Продолжительность (integer seconds).
 */

import ExcelJS from "exceljs";
import { normalizeCostEstimateBNumber } from "@/modules/cost-estimate/normalize";
import {
  COST_ESTIMATE_INPUT_HEADERS,
  COST_ESTIMATE_MAX_DETAILS,
  COST_ESTIMATE_MAX_ROWS,
  COST_ESTIMATE_PARSE_ERROR,
  type CostEstimateInputRow,
} from "@/modules/cost-estimate/types";

type ParseOk = { ok: true; rows: CostEstimateInputRow[] };
type ParseErr = { ok: false; error: string; details: string[] };
export type ParseCostEstimateXlsxResult = ParseOk | ParseErr;

const HEADER_DETAIL =
  "Первая строка должна содержать столбцы «Дата», «A-номер», «B-номер», «Продолжительность»";

function pushDetail(details: string[], line: string): void {
  if (details.length >= COST_ESTIMATE_MAX_DETAILS) return;
  details.push(line);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local civil clock: YYYY-MM-DD HH:mm:ss (always includes time). */
export function formatDateTimeLocal(value: Date): string {
  const y = value.getFullYear();
  const m = pad2(value.getMonth() + 1);
  const d = pad2(value.getDate());
  const hh = pad2(value.getHours());
  const mm = pad2(value.getMinutes());
  const ss = pad2(value.getSeconds());
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

/**
 * Excel 1900 date system serial → Date (local wall time from the UTC day).
 * Accepts day fractions for time-of-day.
 */
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 1 || serial >= 100000) return null;
  const ms = Math.round(serial * 86400000);
  return new Date(Date.UTC(1899, 11, 30) + ms);
}

/** Strip Excel/JS timezone tails like « GMT+0700 (… )». */
function stripTimezoneSuffix(raw: string): string {
  return raw
    .replace(/\s+GMT[^\n]*$/i, "")
    .replace(/\s+UTC[^\n]*$/i, "")
    .trim();
}

/** Дата column only: Date value first, never keep GMT* from cell.text. */
export function dateCellDisplay(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value instanceof Date) return formatDateTimeLocal(value);
  if (typeof value === "number") {
    const fromSerial = excelSerialToDate(value);
    if (fromSerial) return formatDateTimeLocal(fromSerial);
  }
  if (value && typeof value === "object" && "result" in value) {
    const result = value.result;
    if (result instanceof Date) return formatDateTimeLocal(result);
    if (typeof result === "number") {
      const fromSerial = excelSerialToDate(result);
      if (fromSerial) return formatDateTimeLocal(fromSerial);
    }
  }
  const text = cellDisplayText(cell);
  return stripTimezoneSuffix(text);
}

function cellDisplayText(cell: ExcelJS.Cell): string {
  const text = typeof cell.text === "string" ? cell.text.replace(/\uFEFF/g, "").trim() : "";
  if (text) return text;
  return cellValueFallback(cell.value);
}

function cellValueFallback(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value.replace(/\uFEFF/g, "").trim();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return formatDateTimeLocal(value);
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part.text ?? "")
        .join("")
        .replace(/\uFEFF/g, "")
        .trim();
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text.replace(/\uFEFF/g, "").trim();
    }
    if ("result" in value) return cellValueFallback(value.result as ExcelJS.CellValue);
  }
  return "";
}

function parseSeconds(cell: ExcelJS.Cell, rowNumber: number): number | string {
  const value = cell.value;
  if (value == null || value === "") {
    return `Строка ${rowNumber}: пустая «Продолжительность»`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      return `Строка ${rowNumber}: «Продолжительность» должна быть целым числом секунд`;
    }
    return value;
  }
  if (typeof value === "boolean") {
    return `Строка ${rowNumber}: «Продолжительность» должна быть целым числом секунд`;
  }
  if (value instanceof Date) {
    return `Строка ${rowNumber}: «Продолжительность» должна быть целым числом секунд`;
  }
  const text = cellDisplayText(cell);
  if (!/^\d+$/.test(text)) {
    return `Строка ${rowNumber}: «Продолжительность» должна быть целым числом секунд`;
  }
  const seconds = Number(text);
  if (!Number.isSafeInteger(seconds)) {
    return `Строка ${rowNumber}: «Продолжительность» слишком большая`;
  }
  return seconds;
}

function headerTexts(row: ExcelJS.Row): string[] {
  const out: string[] = [];
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    out[col - 1] = cellDisplayText(cell);
  });
  return out.map((h) => h.replace(/\uFEFF/g, "").trim());
}

function rowEmpty(row: ExcelJS.Row): boolean {
  let empty = true;
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (cellDisplayText(cell)) empty = false;
  });
  return empty;
}

export async function parseCostEstimateXlsx(
  buffer: Buffer,
): Promise<ParseCostEstimateXlsxResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    return {
      ok: false,
      error: COST_ESTIMATE_PARSE_ERROR,
      details: ["Файл XLSX не прочитан"],
    };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return {
      ok: false,
      error: COST_ESTIMATE_PARSE_ERROR,
      details: ["В книге нет листов"],
    };
  }

  const headers = headerTexts(sheet.getRow(1));
  if (
    !COST_ESTIMATE_INPUT_HEADERS.every(
      (header, index) => headers[index] === header,
    )
  ) {
    return {
      ok: false,
      error: COST_ESTIMATE_PARSE_ERROR,
      details: [HEADER_DETAIL],
    };
  }

  const rows: CostEstimateInputRow[] = [];
  const details: string[] = [];

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (rowEmpty(row)) continue;

    if (rows.length >= COST_ESTIMATE_MAX_ROWS) {
      return {
        ok: false,
        error: COST_ESTIMATE_PARSE_ERROR,
        details: [
          `Слишком много строк. Максимум ${COST_ESTIMATE_MAX_ROWS}`,
        ],
      };
    }

    const dateDisplay = dateCellDisplay(row.getCell(1));
    const aNumberRaw = cellDisplayText(row.getCell(2));
    let aDigits = "";
    if (aNumberRaw) {
      const normalizedA = normalizeCostEstimateBNumber(aNumberRaw);
      if (!normalizedA) {
        pushDetail(details, `Строка ${r}: «A-номер» не подходит для тарификации`);
        continue;
      }
      aDigits = normalizedA;
    }

    const bNumberRaw = cellDisplayText(row.getCell(3));
    if (!bNumberRaw) {
      pushDetail(details, `Строка ${r}: пустой «B-номер»`);
      continue;
    }
    const bDigits = normalizeCostEstimateBNumber(bNumberRaw);
    if (!bDigits) {
      pushDetail(details, `Строка ${r}: «B-номер» не подходит для тарификации`);
      continue;
    }

    const secondsOrErr = parseSeconds(row.getCell(4), r);
    if (typeof secondsOrErr === "string") {
      pushDetail(details, secondsOrErr);
      continue;
    }

    rows.push({
      rowNumber: r,
      dateDisplay,
      aNumberRaw,
      aDigits,
      bNumberRaw,
      bDigits,
      seconds: secondsOrErr,
    });
  }

  if (details.length > 0) {
    return { ok: false, error: COST_ESTIMATE_PARSE_ERROR, details };
  }

  if (rows.length === 0) {
    return {
      ok: false,
      error: COST_ESTIMATE_PARSE_ERROR,
      details: ["В файле нет строк данных"],
    };
  }

  return { ok: true, rows };
}
