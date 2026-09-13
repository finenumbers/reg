/**
 * Build registrations list XLSX (full table, no filters).
 */

import {
  createSimpleWorkbook,
  formatExportTimestamp,
  workbookToBuffer,
  XLSX_UNREGISTERED_FILL,
} from "@/lib/xlsx-export";
import { loadAllRegistrationItems } from "@/modules/registrations/service";
import { getDisplayTimezone } from "@/modules/settings";
import type { RegistrationListItem } from "@/modules/registrations/types";
import {
  formatEndpoint,
  formatRegStatus,
  formatTimestamp,
  REG_COLUMN_HEADERS,
  REG_COLUMN_ORDER,
} from "@/modules/registrations/ui-format";

export const REG_EXPORT_COLUMNS = REG_COLUMN_ORDER;

export function registrationExportCell(
  row: RegistrationListItem,
  column: (typeof REG_EXPORT_COLUMNS)[number],
  timeZone: string,
): string {
  switch (column) {
    case "phone":
      return row.phone;
    case "channelality":
      return row.channelality ?? "";
    case "description":
      return row.description ?? "";
    case "status":
      return formatRegStatus(row.status);
    case "endpoint":
      return formatEndpoint(row.ip, row.port);
    case "country":
      return row.country ?? "";
    case "city":
      return row.city ?? "";
    case "isp":
      return row.isp ?? "";
    case "lastChangedAt":
      return formatTimestamp(row.lastChangedAt, timeZone);
    case "lastSeenAt":
      return formatTimestamp(row.lastSeenAt, timeZone);
  }
}

export function registrationExportRow(
  row: RegistrationListItem,
  timeZone: string,
): string[] {
  return REG_EXPORT_COLUMNS.map((key) =>
    registrationExportCell(row, key, timeZone),
  );
}

export type RegsExportResult = {
  buffer: Buffer;
  filename: string;
};

export async function buildRegsExportXlsx(): Promise<RegsExportResult> {
  const [items, timeZone] = await Promise.all([
    loadAllRegistrationItems({ waitGeo: true }),
    getDisplayTimezone(),
  ]);
  const headers = REG_EXPORT_COLUMNS.map((key) => REG_COLUMN_HEADERS[key]!);
  const rows = items.map((row) => registrationExportRow(row, timeZone));
  const workbook = createSimpleWorkbook({
    sheetName: "Регистрации",
    headers,
    rows,
    highlightFill: XLSX_UNREGISTERED_FILL,
    highlightRow: (index) => items[index]?.status === "Unregistered",
  });
  const buffer = await workbookToBuffer(workbook);
  return {
    buffer,
    filename: `regs-${formatExportTimestamp(new Date(), timeZone)}.xlsx`,
  };
}
