/**
 * Parse the cost-estimate input workbook.
 * Headers: Дата, B-номер, Продолжительность (integer seconds).
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
  "Первая строка должна содержать столбцы «Дата», «B-номер», «Продолжительность»";

function pushDetail(details: string[], line: string): void {
  if (details.length >= COST_ESTIMATE_MAX_DETAILS) return;
  details.push(line);
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
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
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

    const dateDisplay = cellDisplayText(row.getCell(1));
    const bNumberRaw = cellDisplayText(row.getCell(2));
    if (!bNumberRaw) {
      pushDetail(details, `Строка ${r}: пустой «B-номер»`);
      continue;
    }
    const bDigits = normalizeCostEstimateBNumber(bNumberRaw);
    if (!bDigits) {
      pushDetail(details, `Строка ${r}: «B-номер» не подходит для тарификации`);
      continue;
    }

    const secondsOrErr = parseSeconds(row.getCell(3), r);
    if (typeof secondsOrErr === "string") {
      pushDetail(details, secondsOrErr);
      continue;
    }

    rows.push({
      rowNumber: r,
      dateDisplay,
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
