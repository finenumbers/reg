/**
 * OPRS sheet. Cells match the table formatters. The stream writer keeps
 * every column as text and neutralizes a leading formula character.
 */

import { EXCEL_MAX_ROWS } from "@/modules/enrich/types";
import { openStreamingWorkbook } from "@/modules/table-export/xlsx-stream";
import {
  BILLING_MINUTES_COLUMN,
  OPRS_COLUMNS,
  OPRS_LABELS,
  OPRS_STATIC_COLUMN_SET,
} from "@/modules/traffic/columns";
import {
  formatBillableMinutesCell,
  formatTrafficCell,
} from "@/modules/traffic/ui-format";

export const OPRS_SHEET_NAME = "Звонки в ОПРС";
export const OPRS_EXPORT_PAGE_SIZE = 2000;

const BOLD = new Set<string>(["bill_ani", "bill_dnis", "tariff_charge"]);

export class OprsExportTooLargeError extends Error {
  constructor(total: number) {
    super(
      `Слишком много строк (${total}). Максимум листа Excel — ${EXCEL_MAX_ROWS}`,
    );
    this.name = "OprsExportTooLargeError";
  }
}

export function assertOprsExportRowCount(total: number): void {
  if (total > EXCEL_MAX_ROWS) throw new OprsExportTooLargeError(total);
}

export function oprsExportFilename(monthKey: string): string {
  return `Звонки в ОПРС ${monthKey}.xlsx`;
}

/** Same text the table paints. Calltrace is the safe URL already stored on the row. */
export function oprsDisplayCell(column: string, data: Record<string, string>): string {
  if (OPRS_STATIC_COLUMN_SET.has(column)) return "";
  if (column === BILLING_MINUTES_COLUMN) {
    return formatBillableMinutesCell(data.elapsed_time ?? "");
  }
  return formatTrafficCell(column, data[column] ?? "");
}

export async function writeOprsSheet(opts: {
  filePath: string;
  eachRow: (visit: (data: Record<string, string>) => Promise<void>) => Promise<void>;
}): Promise<number> {
  const book = openStreamingWorkbook({
    filePath: opts.filePath,
    sheetName: OPRS_SHEET_NAME,
    columns: OPRS_COLUMNS.map((column) => ({
      header: OPRS_LABELS[column],
      text: true,
      bold: BOLD.has(column),
    })),
  });
  let seen = 0;
  try {
    await opts.eachRow(async (data) => {
      await book.writeRow(OPRS_COLUMNS.map((column) => oprsDisplayCell(column, data)));
      seen += 1;
      if (seen % 40 === 0) {
        await new Promise((resolve) => {
          setImmediate(resolve);
        });
      }
    });
    return await book.finish();
  } catch (error) {
    book.abort();
    throw error;
  }
}
