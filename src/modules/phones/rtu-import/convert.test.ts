import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  convertRtuXlsxToCsv,
  resetRtuImportDefaultsCache,
} from "@/modules/phones/rtu-import";
import { SHEET_GROUPS } from "@/modules/phones/rtu-import/parse-xlsx";

const fixtureDir = path.join(process.cwd(), "ops/fixtures/rtu");

function parseCsvLine(line: string): string[] {
  const cleaned = line.replace(/\r$/, "");
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (inQ) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function groupIdByNameFromFixture(
  xlsx: Buffer,
): Promise<Map<string, string>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(xlsx) as never);
  const ws = wb.getWorksheet(SHEET_GROUPS);
  const map = new Map<string, string>();
  if (!ws) return map;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = String(row.getCell(1).value ?? "").trim();
    const name = String(row.getCell(2).value ?? "").trim();
    if (id && name) map.set(name, id);
  });
  return map;
}

describe("convertRtuXlsxToCsv", () => {
  it("matches golden import.csv for sample.xlsx", async () => {
    resetRtuImportDefaultsCache();
    const xlsx = readFileSync(path.join(fixtureDir, "sample.xlsx"));
    const golden = readFileSync(path.join(fixtureDir, "import.csv"), "utf8")
      .replace(/^\uFEFF/, "")
      .trimEnd();
    const groupIdByName = await groupIdByNameFromFixture(xlsx);
    const result = await convertRtuXlsxToCsv(xlsx, undefined, {
      groupIdByName,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.endpointCount).toBe(2);
    expect(result.gatewayCount).toBe(3);

    const gLines = golden.split("\n");
    const oLines = result.csv.trimEnd().split("\n");
    expect(oLines).toHaveLength(gLines.length);

    for (let r = 0; r < gLines.length; r++) {
      expect(parseCsvLine(oLines[r]!)).toEqual(parseCsvLine(gLines[r]!));
    }
  });

  it("returns detailed errors for invalid workbook", async () => {
    resetRtuImportDefaultsCache();
    const result = await convertRtuXlsxToCsv(Buffer.from("not-xlsx"), undefined, {
      groupIdByName: new Map([["Any", "1"]]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
    expect(result.details.length).toBeGreaterThan(0);
  });

  it("rejects empty upload", async () => {
    const result = await convertRtuXlsxToCsv(new Uint8Array());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details.some((d) => /пустой/i.test(d))).toBe(true);
  });

  it("rejects when routing groups catalog is empty", async () => {
    resetRtuImportDefaultsCache();
    const xlsx = readFileSync(path.join(fixtureDir, "sample.xlsx"));
    const result = await convertRtuXlsxToCsv(xlsx, undefined, {
      groupIdByName: new Map(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details.some((d) => /Входящие группы/i.test(d))).toBe(true);
  });
});
