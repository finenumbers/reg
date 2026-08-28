/**
 * Stream CDR CSV → JSONL. Semicolon, quoted fields, optional UTF-8 BOM.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import {
  EXCEL_MAX_ROWS,
  type CdrJsonlRow,
} from "@/modules/enrich/types";
import { stripIpPort } from "@/modules/enrich/types";

export type ParseCsvResult = {
  rows: number;
  badLines: number;
  uniquePhones: string[];
  uniqueIps: string[];
};

function stripBom(line: string): string {
  return line.charCodeAt(0) === 0xfeff ? line.slice(1) : line;
}

/** Split a semicolon-separated quoted CSV line. */
export function splitQuotedSemicolon(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ";" && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

export function parseCdrLine(line: string): CdrJsonlRow | null {
  const fields = splitQuotedSemicolon(line.trim());
  if (fields.length !== 10) return null;
  const seconds = Number.parseInt(fields[3]!.trim(), 10);
  if (!Number.isFinite(seconds)) return null;
  const aNumber = fields[1]!.trim();
  const bNumber = fields[2]!.trim();
  const initEndpoint = fields[8]!.trim();
  const termEndpoint = fields[9]!.trim();
  return {
    time: fields[0]!.trim(),
    aNumber,
    bNumber,
    seconds,
    initDevice: fields[4]!.trim(),
    termDevice: fields[5]!.trim(),
    dialObject: fields[6]!.trim(),
    cause: fields[7]!.trim(),
    initEndpoint,
    termEndpoint,
    initIp: stripIpPort(initEndpoint),
    termIp: stripIpPort(termEndpoint),
  };
}

export async function parseCsvToJsonl(
  csvPath: string,
  jsonlPath: string,
): Promise<ParseCsvResult> {
  const phones = new Set<string>();
  const ips = new Set<string>();
  let rows = 0;
  let badLines = 0;
  let first = true;

  const input = createReadStream(csvPath, { encoding: "utf8" });
  const output = createWriteStream(jsonlPath, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const rawLine of rl) {
      let line = rawLine;
      if (first) {
        line = stripBom(line);
        first = false;
      }
      if (!line.trim()) continue;
      const row = parseCdrLine(line);
      if (!row) {
        badLines += 1;
        continue;
      }
      rows += 1;
      if (rows > EXCEL_MAX_ROWS) {
        throw new Error(
          `Слишком много строк (${rows}). Максимум листа Excel — ${EXCEL_MAX_ROWS}`,
        );
      }
      if (row.aNumber) phones.add(row.aNumber);
      if (row.bNumber) phones.add(row.bNumber);
      if (row.initIp) ips.add(row.initIp);
      if (row.termIp) ips.add(row.termIp);
      if (!output.write(`${JSON.stringify(row)}\n`)) {
        await new Promise<void>((resolve) => output.once("drain", resolve));
      }
    }
  } finally {
    output.end();
    await finished(output);
  }

  if (rows === 0) {
    throw new Error("В файле нет валидных строк CDR");
  }

  return {
    rows,
    badLines,
    uniquePhones: [...phones],
    uniqueIps: [...ips],
  };
}
