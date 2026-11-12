/**
 * Parse a mask XLSX snapshot.
 * The header row must be MASK_HEADERS, in that order.
 * Digit length is 5, 6, or 7 and equals the mask length.
 * The mask is text: a numeric cell would drop leading zeros.
 * Category is required text. ABC, type, premium, and purchase may be empty.
 */

import ExcelJS from "exceljs";

export const MASK_HEADERS = [
  "Разрядность",
  "Категория",
  "ABC",
  "Маска",
  "Тип",
  "Покупка",
  "Премиум",
] as const;

const MASK_HEADER_ERROR = `В первой строке должны быть столбцы ${MASK_HEADERS.map((name) => `«${name}»`).join(", ")} в этом порядке и больше ничего`;

export const MASK_MAX_ROWS = 50_000;
export const MASK_MAX_ERRORS = 30;
const MAX_TEXT = 200;
const MAX_ABC = 15;
const MASK_TEXT = /^[0-9A-DX-Z]+$/;
const DIGIT_LENGTHS = new Set([5, 6, 7]);

export type MaskParsedRow = {
  sortIndex: number;
  digitLength: number;
  category: string;
  abc: string | null;
  mask: string;
  maskType: string | null;
  premium: string | null;
  purchase: string | null;
};

export type MaskParseResult =
  { ok: true; rows: MaskParsedRow[] } | { ok: false; error: string; details: string[] };

const PARSE_ERROR = "Файл не подходит для масок и типов";

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

function fail(details: string[]): MaskParseResult {
  return { ok: false, error: PARSE_ERROR, details };
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
  if (block.length !== MASK_HEADERS.length) return false;
  return block.every((name, index) => name === MASK_HEADERS[index]);
}

function numberToPlain(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  if (Number.isSafeInteger(n)) return String(n);
  const text = String(n);
  if (/[eE]/.test(text)) return null;
  return text;
}

type TextParse = { ok: true; value: string | null } | { ok: false; date: boolean };

function parseRequiredText(value: unknown): TextParse {
  const parsed = parseOptionalText(value);
  if (!parsed.ok) return parsed;
  if (!parsed.value) return { ok: false, date: false };
  return parsed;
}

function parseOptionalText(value: unknown): TextParse {
  const raw = unwrap(value);
  if (raw == null) return { ok: true, value: null };
  if (raw instanceof Date) return { ok: false, date: true };
  if (typeof raw === "number") {
    const text = numberToPlain(raw);
    if (!text || text.length > MAX_TEXT) return { ok: false, date: false };
    return { ok: true, value: text };
  }
  if (typeof raw !== "string") return { ok: false, date: false };
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  if (text.length > MAX_TEXT) return { ok: false, date: false };
  return { ok: true, value: text };
}

type LengthParse = { ok: true; value: number } | { ok: false; date: boolean };

function parseDigitLength(value: unknown): LengthParse {
  const raw = unwrap(value);
  if (raw instanceof Date) return { ok: false, date: true };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || Math.abs(raw - Math.round(raw)) > 1e-6) {
      return { ok: false, date: false };
    }
    const parsed = Math.round(raw);
    if (!DIGIT_LENGTHS.has(parsed)) return { ok: false, date: false };
    return { ok: true, value: parsed };
  }
  if (typeof raw !== "string") return { ok: false, date: false };
  const text = raw.trim();
  if (text !== "5" && text !== "6" && text !== "7") return { ok: false, date: false };
  return { ok: true, value: Number(text) };
}

type MaskCellParse =
  { ok: true; value: string } | { ok: false; numeric: boolean };

function parseMask(value: unknown, digitLength: number | null): MaskCellParse {
  const raw = unwrap(value);
  if (typeof raw === "number") return { ok: false, numeric: true };
  if (typeof raw !== "string") return { ok: false, numeric: false };
  const text = raw.trim();
  if (!text || !MASK_TEXT.test(text)) return { ok: false, numeric: false };
  if (digitLength != null && text.length !== digitLength) return { ok: false, numeric: false };
  return { ok: true, value: text };
}

type AbcParse = { ok: true; value: string | null } | { ok: false };

function parseOptionalAbc(value: unknown): AbcParse {
  const raw = unwrap(value);
  if (raw == null) return { ok: true, value: null };
  if (raw instanceof Date) return { ok: false };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return { ok: false };
    if (Math.abs(raw - Math.round(raw)) > 1e-6) return { ok: false };
    const rounded = Math.round(raw);
    if (!Number.isSafeInteger(rounded)) return { ok: false };
    const text = String(rounded);
    return /^\d{1,15}$/.test(text) ? { ok: true, value: text } : { ok: false };
  }
  if (typeof raw !== "string") return { ok: false };
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  if (!/^\d{1,15}$/.test(text)) return { ok: false };
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

export async function parseMaskXlsx(
  data: ArrayBuffer | Buffer | Uint8Array,
): Promise<MaskParseResult> {
  const wb = await loadWorkbook(data);
  if (!wb) {
    return fail(["Не удалось прочитать файл как XLSX (файл повреждён или это не Excel)"]);
  }
  const ws = wb.worksheets[0];
  if (!ws) return fail(["В книге нет ни одного листа"]);

  const block = readHeaderBlock(ws);
  if (!block || !headersMatch(block)) {
    return fail([MASK_HEADER_ERROR]);
  }

  const col = new Map<string, number>();
  const headerRow = ws.getRow(1);
  for (let c = 1; c <= 32; c++) {
    const raw = unwrap(headerRow.getCell(c).value);
    const name =
      typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
    if (name && !col.has(name)) col.set(name, c);
  }

  const rows: MaskParsedRow[] = [];
  const details: string[] = [];
  let stopped = false;

  const push = (message: string) => {
    if (details.length < MASK_MAX_ERRORS) details.push(message);
    else stopped = true;
  };

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (stopped || rowNumber === 1) return;
    const lengthCell = row.getCell(col.get("Разрядность")!).value;
    const categoryCell = row.getCell(col.get("Категория")!).value;
    const abcCell = row.getCell(col.get("ABC")!).value;
    const maskCell = row.getCell(col.get("Маска")!).value;
    const typeCell = row.getCell(col.get("Тип")!).value;
    const premiumCell = row.getCell(col.get("Премиум")!).value;
    const purchaseCell = row.getCell(col.get("Покупка")!).value;
    if (
      isBlank(lengthCell) &&
      isBlank(categoryCell) &&
      isBlank(abcCell) &&
      isBlank(maskCell) &&
      isBlank(typeCell) &&
      isBlank(premiumCell) &&
      isBlank(purchaseCell)
    ) {
      return;
    }
    if (rows.length >= MASK_MAX_ROWS) {
      push(`В файле больше ${MASK_MAX_ROWS.toLocaleString("ru-RU")} строк данных`);
      stopped = true;
      return;
    }

    const digitLength = parseDigitLength(lengthCell);
    const category = parseRequiredText(categoryCell);
    const abc = parseOptionalAbc(abcCell);
    const mask = parseMask(maskCell, digitLength.ok ? digitLength.value : null);
    const maskType = parseOptionalText(typeCell);
    const premium = parseOptionalText(premiumCell);
    const purchase = parseOptionalText(purchaseCell);

    if (!digitLength.ok) {
      push(
        digitLength.date
          ? `Строка ${rowNumber}: «Разрядность» — текстовый формат, иначе значение становится датой`
          : `Строка ${rowNumber}: «Разрядность» — целое 5, 6 или 7`,
      );
    }
    if (!category.ok) {
      push(
        category.date
          ? `Строка ${rowNumber}: «Категория» — текстовый формат, иначе значение становится датой`
          : `Строка ${rowNumber}: «Категория» — непустой текст до ${MAX_TEXT} символов`,
      );
    }
    if (!abc.ok) {
      push(
        `Строка ${rowNumber}: «ABC» — пусто или только цифры, от 1 до ${MAX_ABC} знаков`,
      );
    }
    if (!mask.ok) {
      push(
        mask.numeric
          ? `Строка ${rowNumber}: «Маска» должна быть текстом, иначе нули в начале пропадают`
          : `Строка ${rowNumber}: «Маска» — цифры и буквы A–D и X–Z, длина равна «Разрядности»`,
      );
    }
    for (const [title, parsed] of [
      ["Тип", maskType],
      ["Премиум", premium],
      ["Покупка", purchase],
    ] as const) {
      if (parsed.ok) continue;
      push(
        parsed.date
          ? `Строка ${rowNumber}: «${title}» — текстовый формат, иначе значение становится датой`
          : `Строка ${rowNumber}: «${title}» — текст до ${MAX_TEXT} символов, число или пусто`,
      );
    }

    if (
      digitLength.ok &&
      category.ok &&
      abc.ok &&
      mask.ok &&
      maskType.ok &&
      premium.ok &&
      purchase.ok
    ) {
      rows.push({
        sortIndex: rows.length,
        digitLength: digitLength.value,
        category: category.value!,
        abc: abc.value,
        mask: mask.value,
        maskType: maskType.value,
        premium: premium.value,
        purchase: purchase.value,
      });
    }
  });

  if (stopped && details.length >= MASK_MAX_ERRORS) {
    details.push("Разбор остановлен после 30 ошибок");
  }
  if (details.length > 0) return fail(details);
  if (rows.length === 0) return fail(["В файле нет строк с данными"]);
  return { ok: true, rows };
}

export function sanitizeMaskFilename(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const base = cleaned || "masks.xlsx";
  return base.length > 255 ? base.slice(0, 255) : base;
}
