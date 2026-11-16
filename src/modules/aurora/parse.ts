/**
 * Aurora CSV. The operator names the layout.
 * A short file reads Column 1 and Column 3. A full file reads Column 1 and Column 4.
 */

export type AuroraFormat = "short" | "full";

export type AuroraRow = {
  e164: string;
  incomingPurchase: string;
};

export type AuroraFileText = {
  name: string;
  format: AuroraFormat;
  text: string;
};

export type ParsedAurora =
  | { ok: true; rows: AuroraRow[]; read: number; dropped: number }
  | { ok: false; error: string };

const SHORT_HEADER = ["Column 1", "Column 2", "Column 3", "Column 4", "Column 5"];
const FULL_HEADER = [
  "Column 1",
  "Column 2",
  "Column 3",
  "Column 4",
  "Column 5",
  "Column 6",
];
const NUMBER = /^7\d{10}$/;
const PRICE = /^(\d+) Руб\.$/;
const CONTRACT = "ДОГОВОРНАЯ";
const FREE_STATUS = "СВОБОДЕН";

export function isAuroraFormat(value: string): value is AuroraFormat {
  return value === "short" || value === "full";
}

export function auroraFormatLabel(format: AuroraFormat): string {
  return format === "short" ? "сокращённый" : "полный";
}

/** One load publishes only when at least one number remains. */
export function shouldPublishAurora(rowCount: number): boolean {
  return rowCount > 0;
}

function fail(name: string, detail: string): { ok: false; error: string } {
  return { ok: false, error: `Файл ${name}: ${detail}` };
}

function rowFail(
  name: string,
  row: number,
  detail: string,
): { ok: false; error: string } {
  return { ok: false, error: `Файл ${name}, строка ${row}: ${detail}` };
}

type Delimiter = "," | ";";

/** Quoted comma-separated records. A field may contain a line break. */
export function parseCommaCsv(text: string): string[][] | null {
  return parseDelimited(text, ",");
}

/** Quoted records. A field may contain a line break. The delimiter is a comma or a semicolon. */
function parseDelimited(text: string, delimiter: Delimiter): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (quoted) return null;
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function blank(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

function headerOf(format: AuroraFormat): readonly string[] {
  return format === "short" ? SHORT_HEADER : FULL_HEADER;
}

function sameHeader(row: readonly string[], expected: readonly string[]): boolean {
  if (row.length !== expected.length) return false;
  return expected.every((cell, index) => row[index]?.trim() === cell);
}

function nationalDigits(cell: string): string | null {
  const digits = cell.replace(/\D/g, "");
  return NUMBER.test(digits) ? digits : null;
}

function purchaseText(cell: string): string | null {
  const trimmed = cell.replace(/[\u00a0\u202f]/g, " ").trim();
  if (trimmed === CONTRACT) return "";
  const match = PRICE.exec(trimmed);
  return match ? match[1]! : null;
}

function firstWidth(table: string[][] | null): number | null {
  const row = table?.find((record) => !blank(record));
  return row ? row.length : null;
}

function tableFor(
  text: string,
  format: AuroraFormat,
): { table: string[][]; header: boolean } | null {
  const comma = parseDelimited(text, ",");
  const semi = parseDelimited(text, ";");
  const expected = headerOf(format);
  const commaHeader = Boolean(comma?.[0] && sameHeader(comma[0], expected));
  const semiHeader = Boolean(semi?.[0] && sameHeader(semi[0], expected));
  if (commaHeader && comma) return { table: comma, header: true };
  if (semiHeader && semi) return { table: semi, header: true };
  const want = expected.length;
  const commaFit = firstWidth(comma) === want;
  const semiFit = firstWidth(semi) === want;
  if (commaFit && !semiFit && comma) return { table: comma, header: false };
  if (semiFit && !commaFit && semi) return { table: semi, header: false };
  return null;
}

function rowsOf(name: string, text: string, format: AuroraFormat): ParsedAurora {
  const chosen = tableFor(text.replace(/^\uFEFF/, ""), format);
  if (!chosen) return fail(name, "формат не совпал.");
  const { table, header } = chosen;
  const expected = headerOf(format);
  const rows: AuroraRow[] = [];
  const priceAt = format === "short" ? 2 : 3;
  for (let index = header ? 1 : 0; index < table.length; index += 1) {
    const record = table[index] ?? [];
    if (blank(record)) continue;
    const line = index + 1;
    if (record.length !== expected.length) return fail(name, "формат не совпал.");
    if (format === "full" && record[1]?.trim() !== FREE_STATUS) {
      return rowFail(name, line, "статус не СВОБОДЕН.");
    }
    const e164 = nationalDigits(record[0] ?? "");
    if (!e164) return rowFail(name, line, "номер не принят.");
    const purchase = purchaseText(record[priceAt] ?? "");
    if (purchase == null) return rowFail(name, line, "цена не принята.");
    rows.push({ e164, incomingPurchase: purchase });
  }
  return { ok: true, rows, read: rows.length, dropped: 0 };
}

/** Every file, in order. A repeated number keeps the earlier price. */
export function combineAuroraFiles(files: readonly AuroraFileText[]): ParsedAurora {
  const rows: AuroraRow[] = [];
  const seen = new Set<string>();
  let read = 0;
  let dropped = 0;
  for (const file of files) {
    const parsed = rowsOf(file.name, file.text, file.format);
    if (!parsed.ok) return parsed;
    read += parsed.read;
    for (const row of parsed.rows) {
      if (seen.has(row.e164)) {
        dropped += 1;
        continue;
      }
      seen.add(row.e164);
      rows.push(row);
    }
  }
  return { ok: true, rows, read, dropped };
}

function utf16(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  const first = bytes[0];
  const second = bytes[1];
  return (first === 0xff && second === 0xfe) || (first === 0xfe && second === 0xff);
}

export function decodeAuroraCsv(
  name: string,
  bytes: Uint8Array,
): { ok: true; text: string } | { ok: false; error: string } {
  if (utf16(bytes)) return fail(name, "кодировка не UTF-8.");
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: true, text: new TextDecoder("windows-1251").decode(bytes) };
  }
}
