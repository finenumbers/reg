/**
 * Parse a tariff XLSX snapshot.
 * Direction is text, ABC is a digit fragment of a phone number,
 * price is a decimal with at most 6 fractional digits.
 */

import ExcelJS from "exceljs";

export const TARIFF_HEADERS = ["Направления", "ABC", "Цена"] as const;

export const TARIFF_MAX_ROWS = 50_000;
export const TARIFF_MAX_ERRORS = 30;
const MAX_DIRECTION = 500;
const MAX_ABC = 15;
const MONEY_SCALE = 6;
const MONEY_INT_DIGITS = 12;
/** Half of the last stored digit (10^-6 / 2). Float noise under this is kept. */
const MONEY_NOISE = 5e-7;

export type TariffParsedRow = {
  sortIndex: number;
  direction: string;
  abc: string;
  price: string;
};

export type TariffParseResult =
  { ok: true; rows: TariffParsedRow[] } | { ok: false; error: string; details: string[] };

const PARSE_ERROR = "Файл не подходит для тарификации";

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

function fail(details: string[]): TariffParseResult {
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
  if (block.length !== TARIFF_HEADERS.length) return false;
  const expected = new Set<string>(TARIFF_HEADERS);
  if (new Set(block).size !== block.length) return false;
  return block.every((name) => expected.has(name));
}

function numberToPlain(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  if (Number.isSafeInteger(n)) return String(n);
  const text = String(n);
  if (/[eE]/.test(text)) return null;
  return text;
}

function parseDirection(value: unknown): string | null {
  const raw = unwrap(value);
  if (typeof raw === "number") {
    const text = numberToPlain(raw);
    if (!text || text.length > MAX_DIRECTION) return null;
    return text;
  }
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > MAX_DIRECTION) return null;
  return text;
}

function parseAbc(value: unknown): string | null {
  const raw = unwrap(value);
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return null;
    if (Math.abs(raw - Math.round(raw)) > 1e-6) return null;
    const rounded = Math.round(raw);
    if (!Number.isSafeInteger(rounded)) return null;
    const text = String(rounded);
    return /^\d{1,15}$/.test(text) ? text : null;
  }
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!/^\d{1,15}$/.test(text) || text.length > MAX_ABC) return null;
  return text;
}

/** Strip trailing zeros. "-0.000000" and "0.000000" become "0". */
export function formatTariffDecimal(value: string): string {
  const neg = value.startsWith("-");
  let body = neg ? value.slice(1) : value;
  if (body.includes(".")) {
    body = body.replace(/0+$/, "").replace(/\.$/, "");
  }
  body = body.replace(/^0+(?=\d)/, "");
  if (!body || body === "0") return "0";
  return `${neg ? "-" : ""}${body}`;
}

function parseMoneyText(input: string): string | null {
  const compact = input
    .trim()
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(compact)) return null;
  const neg = compact.startsWith("-");
  const body = neg ? compact.slice(1) : compact;
  const [intRaw = "", fracRaw = ""] = body.split(".");
  const intPart = intRaw.replace(/^0+(?=\d)/, "") || "0";
  if (intPart.length > MONEY_INT_DIGITS) return null;
  const frac = fracRaw.replace(/0+$/, "");
  if (frac.length > MONEY_SCALE) return null;
  if (intPart === "0" && frac.length === 0) return "0";
  const sign = neg ? "-" : "";
  return frac.length === 0 ? `${sign}${intPart}` : `${sign}${intPart}.${frac}`;
}

function parseMoneyNumber(n: number): string | null {
  if (!Number.isFinite(n) || Math.abs(n) >= 10 ** MONEY_INT_DIGITS) return null;
  const fixed = n.toFixed(MONEY_SCALE);
  const rounded = Number(fixed);
  if (!Number.isFinite(rounded)) return null;
  if (Math.abs(n - rounded) > MONEY_NOISE) return null;
  return formatTariffDecimal(fixed);
}

function parseMoney(value: unknown): string | null {
  const raw = unwrap(value);
  if (typeof raw === "number") return parseMoneyNumber(raw);
  if (typeof raw === "string") return parseMoneyText(raw);
  return null;
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

export async function parseTariffXlsx(
  data: ArrayBuffer | Buffer | Uint8Array,
): Promise<TariffParseResult> {
  const wb = await loadWorkbook(data);
  if (!wb) {
    return fail(["Не удалось прочитать файл как XLSX (файл повреждён или это не Excel)"]);
  }
  const ws = wb.worksheets[0];
  if (!ws) return fail(["В книге нет ни одного листа"]);

  const block = readHeaderBlock(ws);
  if (!block || !headersMatch(block)) {
    return fail([
      "В первой строке должны быть столбцы «Направления», «ABC», «Цена» и больше ничего",
    ]);
  }

  const col = new Map<string, number>();
  const headerRow = ws.getRow(1);
  for (let c = 1; c <= 32; c++) {
    const raw = unwrap(headerRow.getCell(c).value);
    const name =
      typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
    if (name && !col.has(name)) col.set(name, c);
  }

  const rows: TariffParsedRow[] = [];
  const details: string[] = [];
  let stopped = false;

  const push = (message: string) => {
    if (details.length < TARIFF_MAX_ERRORS) details.push(message);
    else stopped = true;
  };

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (stopped || rowNumber === 1) return;
    const directionCell = row.getCell(col.get("Направления")!).value;
    const abcCell = row.getCell(col.get("ABC")!).value;
    const priceCell = row.getCell(col.get("Цена")!).value;
    if (isBlank(directionCell) && isBlank(abcCell) && isBlank(priceCell)) {
      return;
    }
    if (rows.length >= TARIFF_MAX_ROWS) {
      push(`В файле больше ${TARIFF_MAX_ROWS.toLocaleString("ru-RU")} строк данных`);
      stopped = true;
      return;
    }

    const direction = parseDirection(directionCell);
    const abc = parseAbc(abcCell);
    const price = parseMoney(priceCell);
    if (!direction) {
      push(
        `Строка ${rowNumber}: «Направления» должно быть непустым текстом до ${MAX_DIRECTION} символов`,
      );
    }
    if (!abc) {
      push(`Строка ${rowNumber}: «ABC» — только цифры, от 1 до ${MAX_ABC} знаков`);
    }
    if (!price) {
      push(`Строка ${rowNumber}: «Цена» должна быть числом`);
    }
    if (direction && abc && price) {
      rows.push({
        sortIndex: rows.length,
        direction,
        abc,
        price,
      });
    }
  });

  if (stopped && details.length >= TARIFF_MAX_ERRORS) {
    details.push("Разбор остановлен после 30 ошибок");
  }
  if (details.length > 0) return fail(details);
  if (rows.length === 0) return fail(["В файле нет строк с данными"]);
  return { ok: true, rows };
}

export function sanitizeTariffFilename(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const base = cleaned || "tariffs.xlsx";
  return base.length > 255 ? base.slice(0, 255) : base;
}
