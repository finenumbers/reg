/**
 * Eltex SMG-1016M CDR text.
 * Line 1 is the banner, line 2 is the English header, calls start at line 3.
 */

import {
  emptySmgFields,
  matchSmgHeader,
  SMG_COLUMNS,
  smgRecordKey,
  type SmgField,
} from "@/modules/smg/columns";

const BANNER_RE = /^SMG1016M\. CDR\. File started at '\d{14}'/;
const DISCONNECT_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

export type ParsedSmgCall = {
  fields: Record<SmgField, string>;
  recordKey: string;
  disconnectDay: string;
};

export type ParseSmgResult = {
  rows: ParsedSmgCall[];
  linesBad: number;
  firstBadLine: number | null;
  /** Set when the file must stay in the inbox. */
  error: string | null;
};

export function splitSmgRow(line: string): string[] {
  const parts = line.split(";");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

export function decodeSmgBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

function lineError(filename: string, lineNo: number, reason: string): string {
  return `${filename}: строка ${lineNo}: ${reason}`;
}

export function parseSmgText(text: string, filename: string): ParseSmgResult {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = body.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  if (lines.length === 0 || !BANNER_RE.test(lines[0] ?? "")) {
    return {
      rows: [],
      linesBad: 0,
      firstBadLine: 1,
      error: `${filename}: нет баннера SMG1016M`,
    };
  }
  if (lines.length < 2) {
    return {
      rows: [],
      linesBad: 0,
      firstBadLine: 2,
      error: `${filename}: нет заголовка`,
    };
  }

  const header = splitSmgRow(lines[1] ?? "");
  const kind = matchSmgHeader(header);
  if (!kind) {
    return {
      rows: [],
      linesBad: 0,
      firstBadLine: 2,
      error: `${filename}: неизвестный заголовок CDR`,
    };
  }

  const headerIndex = new Map<string, number>();
  header.forEach((name, index) => headerIndex.set(name, index));

  const rows: ParsedSmgCall[] = [];
  const seen = new Set<string>();
  let linesBad = 0;
  let firstBadLine: number | null = null;
  let firstReason = "";

  for (let index = 2; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    if (!raw.trim()) continue;
    const lineNo = index + 1;
    const values = splitSmgRow(raw);
    if (values.length > header.length) {
      linesBad += 1;
      if (firstBadLine == null) {
        firstBadLine = lineNo;
        firstReason = "строка шире заголовка";
      }
      continue;
    }

    const fields = emptySmgFields();
    for (const column of SMG_COLUMNS) {
      const at = headerIndex.get(column.header);
      if (at == null || at >= values.length) continue;
      fields[column.field] = values[at]?.trim() ?? "";
    }

    if (!fields.deviceSign) {
      linesBad += 1;
      if (firstBadLine == null) {
        firstBadLine = lineNo;
        firstReason = "пустой узел";
      }
      continue;
    }
    const disconnect = DISCONNECT_RE.exec(fields.disconnectTime);
    if (!disconnect) {
      linesBad += 1;
      if (firstBadLine == null) {
        firstBadLine = lineNo;
        firstReason = "нераспознано время разъединения";
      }
      continue;
    }
    const recordKey = smgRecordKey(fields);
    if (!recordKey) {
      linesBad += 1;
      if (firstBadLine == null) {
        firstBadLine = lineNo;
        firstReason = "нет идентификатора вызова";
      }
      continue;
    }
    if (seen.has(recordKey)) continue;
    seen.add(recordKey);
    rows.push({
      fields,
      recordKey,
      disconnectDay: disconnect[1] ?? "",
    });
  }

  if (linesBad > 0) {
    return {
      rows,
      linesBad,
      firstBadLine,
      error: lineError(filename, firstBadLine ?? 0, firstReason),
    };
  }

  return { rows, linesBad: 0, firstBadLine: null, error: null };
}
