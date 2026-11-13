/**
 * Parse a marking XLSX snapshot.
 * The header row must be MARKING_HEADERS, in that order.
 * The phone number is digits stored as text. A safe Excel integer is accepted.
 * Client may be empty. The phone is the exact screen text, up to 200 characters.
 * Operator marking and MAV cells may be empty.
 */

import ExcelJS from "exceljs";
import { EXCEL_SHEET_MAX_DATA_ROWS } from "@/modules/table-export/xlsx-stream";

export const MARKING_HEADERS = [
  "Клиент",
  "Номер",
  "Маркировка МТС",
  "Маркировка Мегафон",
  "Маркировка Билайн",
  "Маркировка Т2",
  "МАВ МТС",
  "МАВ Мегафон",
  "МАВ Билайн",
  "МАВ Т2",
] as const;

const OPTIONAL_FIELDS = [
  ["Маркировка МТС", "labelMts"],
  ["Маркировка Мегафон", "labelMegafon"],
  ["Маркировка Билайн", "labelBeeline"],
  ["Маркировка Т2", "labelT2"],
  ["МАВ МТС", "mavMts"],
  ["МАВ Мегафон", "mavMegafon"],
  ["МАВ Билайн", "mavBeeline"],
  ["МАВ Т2", "mavT2"],
] as const;

export const MARKING_PARSE_ERROR = "Файл не подходит для маркировки и МАВ";
const MARKING_HEADER_ERROR = `В первой строке должны быть столбцы ${MARKING_HEADERS.map((name) => `«${name}»`).join(", ")} в этом порядке и больше ничего`;

export const MARKING_MAX_ROWS = EXCEL_SHEET_MAX_DATA_ROWS;
export const MARKING_MAX_ERRORS = 30;
const MAX_TEXT = 200;

export type MarkingParsedRow = {
  sortIndex: number;
  client: string;
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

export type MarkingParseResult =
  | { ok: true; rows: MarkingParsedRow[] }
  | { ok: false; error: string; details: string[] };

function unwrap(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as {
    formula?: unknown;
    sharedFormula?: unknown;
    result?: unknown;
    richText?: Array<{ text?: string }>;
    text?: unknown;
    error?: unknown;
  };
  if ("error" in obj && obj.error != null) return obj;
  if ("formula" in obj || "sharedFormula" in obj) return unwrap(obj.result);
  if (Array.isArray(obj.richText)) {
    return obj.richText.map((part) => part.text ?? "").join("");
  }
  if (typeof obj.text === "string") return obj.text;
  return value;
}

function isBlank(value: unknown): boolean {
  const raw = unwrap(value);
  if (raw == null) return true;
  if (typeof raw === "string") return raw.trim() === "";
  return false;
}

function fail(details: string[]): MarkingParseResult {
  return { ok: false, error: MARKING_PARSE_ERROR, details };
}

function readHeaderBlock(ws: ExcelJS.Worksheet): string[] | null {
  const row = ws.getRow(1);
  const cells: string[] = [];
  for (let col = 1; col <= 32; col++) {
    const raw = unwrap(row.getCell(col).value);
    cells.push(
      typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim(),
    );
  }
  const first = cells.findIndex((cell) => cell.length > 0);
  if (first < 0) return null;
  const block: string[] = [];
  for (let i = first; i < cells.length; i++) {
    if (!cells[i]) break;
    block.push(cells[i]!);
  }
  if (cells.slice(first + block.length).some((cell) => cell.length > 0)) {
    return null;
  }
  return block;
}

function headersMatch(block: string[]): boolean {
  if (block.length !== MARKING_HEADERS.length) return false;
  return block.every((name, index) => name === MARKING_HEADERS[index]);
}

type TextParse = { ok: true; value: string | null } | { ok: false; date: boolean };

function parseOptionalText(value: unknown): TextParse {
  const raw = unwrap(value);
  if (raw == null) return { ok: true, value: null };
  if (raw instanceof Date) return { ok: false, date: true };
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) return { ok: false, date: false };
    const text = String(raw);
    if (/[eE.]/.test(text) || text.length > MAX_TEXT) return { ok: false, date: false };
    return { ok: true, value: text };
  }
  if (typeof raw !== "string") return { ok: false, date: false };
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  if (text.length > MAX_TEXT) return { ok: false, date: false };
  return { ok: true, value: text };
}

type PhoneParse = { ok: true; value: string } | { ok: false; date: boolean };

function parsePhone(value: unknown): PhoneParse {
  const raw = unwrap(value);
  if (raw instanceof Date) return { ok: false, date: true };
  let text: string | null = null;
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) return { ok: false, date: false };
    text = String(raw);
    if (/[eE.]/.test(text)) return { ok: false, date: false };
  } else if (typeof raw === "string") {
    text = raw.trim();
  } else {
    return { ok: false, date: false };
  }
  if (!text || text.length > MAX_TEXT) return { ok: false, date: false };
  if (/[\u0000-\u001F\u007F]/.test(text)) return { ok: false, date: false };
  return { ok: true, value: text };
}

async function loadWorkbook(
  data: ArrayBuffer | Buffer | Uint8Array,
): Promise<ExcelJS.Workbook | null> {
  const wb = new ExcelJS.Workbook();
  try {
    const u8: Uint8Array = Buffer.isBuffer(data)
      ? new Uint8Array(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data);
    await wb.xlsx.load(u8 as never);
    return wb;
  } catch {
    return null;
  }
}

export async function parseMarkingXlsx(
  data: ArrayBuffer | Buffer | Uint8Array,
): Promise<MarkingParseResult> {
  const wb = await loadWorkbook(data);
  if (!wb) {
    return fail(["Не удалось прочитать файл как XLSX (файл повреждён или это не Excel)"]);
  }
  const ws = wb.worksheets[0];
  if (!ws) return fail(["В книге нет ни одного листа"]);

  const block = readHeaderBlock(ws);
  if (!block || !headersMatch(block)) {
    return fail([MARKING_HEADER_ERROR]);
  }

  const col = new Map<string, number>();
  const headerRow = ws.getRow(1);
  for (let c = 1; c <= 32; c++) {
    const raw = unwrap(headerRow.getCell(c).value);
    const name =
      typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
    if (name && !col.has(name)) col.set(name, c);
  }

  const rows: MarkingParsedRow[] = [];
  const details: string[] = [];
  const seenPhone = new Map<string, number>();
  let stopped = false;

  const push = (message: string) => {
    if (details.length < MARKING_MAX_ERRORS) details.push(message);
    else stopped = true;
  };

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (stopped || rowNumber === 1) return;
    const cells = new Map<string, unknown>();
    for (const name of MARKING_HEADERS) {
      cells.set(name, row.getCell(col.get(name)!).value);
    }
    if ([...cells.values()].every((value) => isBlank(value))) return;
    if (rows.length >= MARKING_MAX_ROWS) {
      push(`В файле больше ${MARKING_MAX_ROWS.toLocaleString("ru-RU")} строк данных`);
      stopped = true;
      return;
    }

    const client = parseOptionalText(cells.get("Клиент"));
    const phone = parsePhone(cells.get("Номер"));
    const optional = OPTIONAL_FIELDS.map(
      ([title, field]) => [field, title, parseOptionalText(cells.get(title))] as const,
    );

    if (!client.ok) {
      push(
        client.date
          ? `Строка ${rowNumber}: «Клиент» — текстовый формат, иначе значение становится датой`
          : `Строка ${rowNumber}: «Клиент» — текст до ${MAX_TEXT} символов или пусто`,
      );
    }
    if (!phone.ok) {
      push(
        phone.date
          ? `Строка ${rowNumber}: «Номер» — текстовый или числовой формат, иначе значение становится датой`
          : `Строка ${rowNumber}: «Номер» — непустой текст до ${MAX_TEXT} символов`,
      );
    }
    for (const [, title, parsed] of optional) {
      if (parsed.ok) continue;
      push(
        parsed.date
          ? `Строка ${rowNumber}: «${title}» — текстовый формат, иначе значение становится датой`
          : `Строка ${rowNumber}: «${title}» — текст до ${MAX_TEXT} символов, целое число или пусто`,
      );
    }

    const optionalOk = optional.every(([, , parsed]) => parsed.ok);
    if (!client.ok || !phone.ok || !optionalOk) return;

    const first = seenPhone.get(phone.value);
    if (first != null) {
      push(`Строка ${rowNumber}: «Номер» повторяет строку ${first}`);
      return;
    }
    seenPhone.set(phone.value, rowNumber);

    const record: MarkingParsedRow = {
      sortIndex: rows.length,
      client: client.value ?? "",
      phoneNumber: phone.value,
      labelMts: null,
      labelMegafon: null,
      labelBeeline: null,
      labelT2: null,
      mavMts: null,
      mavMegafon: null,
      mavBeeline: null,
      mavT2: null,
    };
    for (const [field, , parsed] of optional) {
      if (parsed.ok) record[field] = parsed.value;
    }
    rows.push(record);
  });

  if (stopped && details.length >= MARKING_MAX_ERRORS) {
    details.push("Разбор остановлен после 30 ошибок");
  }
  if (details.length > 0) return fail(details);
  if (rows.length === 0) return fail(["В файле нет строк с данными"]);
  return { ok: true, rows };
}

export function sanitizeMarkingFilename(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const base = cleaned || "marking.xlsx";
  return base.length > 255 ? base.slice(0, 255) : base;
}
