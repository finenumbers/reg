/**
 * Full-dump CDR CSV parser (120 semicolon-quoted columns).
 * Does not use enrich/parseCdrLine (10-column contract).
 */

import { splitQuotedSemicolon } from "@/modules/enrich/parse-csv";
import { parseNaiveDateTime } from "@/modules/enrich/dates";
import { splitCdrDateParts } from "@/modules/traffic/cdr-date-parts";
import {
  CDR_COLUMNS,
  CDR_COLUMN_COUNT,
  csvHeaderToCamel,
  headersMatchCanonical,
} from "@/modules/traffic/columns";

export function stripBom(line: string): string {
  return line.charCodeAt(0) === 0xfeff ? line.slice(1) : line;
}

export function parseCdrHeaderLine(line: string): string[] {
  return splitQuotedSemicolon(stripBom(line).trim()).map((h) => h.trim());
}

export function assertCanonicalCdrHeader(headers: readonly string[]): void {
  if (!headersMatchCanonical(headers)) {
    const got = headers.join(";");
    throw new Error(
      `Неверный заголовок CDR: ожидалось ${CDR_COLUMN_COUNT} полей канонического дампа, получено ${headers.length}. ${got.slice(0, 240)}`,
    );
  }
}

export type ParsedCdrRow = {
  fields: Record<string, string>;
  prisma: Record<string, string>;
  cdrId: string;
  cdrAt: Date | null;
};

export function parseCdrDate(raw: string): Date | null {
  return parseNaiveDateTime(raw);
}

export function parseCdrDataLine(line: string): ParsedCdrRow | null {
  const values = splitQuotedSemicolon(stripBom(line).trim());
  if (values.length !== CDR_COLUMN_COUNT) return null;
  const fields: Record<string, string> = {};
  const prisma: Record<string, string> = {};
  for (let i = 0; i < CDR_COLUMN_COUNT; i++) {
    const header = CDR_COLUMNS[i]!;
    const value = values[i] ?? "";
    fields[header] = value;
    prisma[csvHeaderToCamel(header)] = value;
  }
  const cdrId = fields.cdr_id?.trim() ?? "";
  if (!cdrId) return null;
  const parts = splitCdrDateParts(fields.cdr_date ?? "");
  prisma.cdrDay = parts.day;
  prisma.cdrTime = parts.time;
  return {
    fields,
    prisma,
    cdrId,
    cdrAt: parseCdrDate(fields.cdr_date ?? ""),
  };
}
