import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { OPRS_COLUMNS, OPRS_LABELS } from "@/modules/traffic/columns";
import {
  OPRS_SHEET_NAME,
  oprsDisplayCell,
  oprsExportFilename,
  writeOprsSheet,
} from "@/modules/oprs/xlsx-export";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function row(patch: Record<string, string> = {}): Record<string, string> {
  return {
    cdr_day: "2026-11-13",
    cdr_time: "10:00:00",
    elapsed_time: "61000",
    tariff_charge: "1.5",
    bill_ani: "0123456789",
    operator_b: "=МТС",
    geography_b: "г. Москва",
    voipmonitor_url_in: "https://voip.example/call/1",
    ...patch,
  };
}

describe("OPRS xlsx cells", () => {
  it("formats minutes and cost the way the table does and leaves marking blank", () => {
    const data = row();
    expect(oprsDisplayCell("cdr_day", data)).toBe("13.11.2026");
    expect(oprsDisplayCell("billable_minutes", data)).toBe("2");
    expect(oprsDisplayCell("tariff_charge", data)).toBe("1.50");
    expect(oprsDisplayCell("oprs_marking", data)).toBe("");
    expect(oprsDisplayCell("oprs_mav", data)).toBe("");
    expect(oprsDisplayCell("voipmonitor_url_in", data)).toBe("https://voip.example/call/1");
    expect(oprsExportFilename("2026-11")).toBe("Звонки в ОПРС 2026-11.xlsx");
  });
});

describe("OPRS xlsx file", () => {
  it("writes phones as text and neutralizes a formula", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "oprs-xlsx-test-"));
    dirs.push(dir);
    const filePath = path.join(dir, "out.xlsx");
    await writeOprsSheet({
      filePath,
      eachRow: async (visit) => {
        await visit(row());
      },
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.getWorksheet(OPRS_SHEET_NAME);
    const headers = sheet?.getRow(1).values;
    expect(Array.isArray(headers) ? headers.slice(1) : []).toEqual(
      OPRS_COLUMNS.map((column) => OPRS_LABELS[column]),
    );
    const phoneIndex = OPRS_COLUMNS.indexOf("bill_ani") + 1;
    const operatorIndex = OPRS_COLUMNS.indexOf("operator_b") + 1;
    const markingIndex = OPRS_COLUMNS.indexOf("oprs_marking") + 1;
    const phone = sheet?.getRow(2).getCell(phoneIndex);
    expect(phone?.value).toBe("0123456789");
    expect(typeof phone?.value).toBe("string");
    expect(phone?.numFmt).toBe("@");
    expect(sheet?.getRow(2).getCell(operatorIndex).value).toBe("'=МТС");
    expect(sheet?.getRow(2).getCell(markingIndex).value ?? "").toBe("");
  });
});
