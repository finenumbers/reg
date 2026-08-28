/**
 * Full-dump CDR CSV parser (120 semicolon-quoted columns).
 * Does not use enrich/parseCdrLine (10-column contract).
 */

import { splitQuotedSemicolon } from "@/modules/enrich/parse-csv";
import {
  CDR_COLUMNS,
  CDR_COLUMN_COUNT,
  csvHeaderToCamel,
  headersMatchCanonical,
} from "@/modules/traffic/columns";
import {
  DEFAULT_DISPLAY_TIMEZONE,
  resolveDisplayTimezone,
  TZ_OFFSET_HOURS,
} from "@/lib/display-timezone";

const CDR_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

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

export function parseCdrDate(
  raw: string,
  timeZone: string = DEFAULT_DISPLAY_TIMEZONE,
): Date | null {
  const match = CDR_DATE_RE.exec(raw.trim());
  if (!match) return null;
  const zone = resolveDisplayTimezone(timeZone);
  const offsetHours = TZ_OFFSET_HOURS[zone];
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
  const asUtc = Date.parse(`${iso}Z`);
  if (!Number.isFinite(asUtc)) return null;
  return new Date(asUtc - offsetHours * 3600_000);
}

export function parseCdrDataLine(
  line: string,
  timeZone?: string,
): ParsedCdrRow | null {
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
  return {
    fields,
    prisma,
    cdrId,
    cdrAt: parseCdrDate(fields.cdr_date ?? "", timeZone),
  };
}
