/**
 * Build registrations list XLSX (full table, no filters).
 */

import {
  createSimpleWorkbook,
  formatExportTimestamp,
  workbookToBuffer,
} from "@/lib/xlsx-export";
import { loadAllRegistrationItems } from "@/modules/registrations/service";
import { getDisplayTimezone } from "@/modules/settings";
import type { RegistrationListItem } from "@/modules/registrations/types";
import {
  formatEndpoint,
  formatRegStatus,
  formatTimestamp,
  REG_COLUMN_HEADERS,
} from "@/modules/registrations/ui-format";

const REG_EXPORT_COLUMNS = [
  "phone",
  "description",
  "status",
  "endpoint",
  "country",
  "city",
  "isp",
  "lastChangedAt",
  "lastSeenAt",
] as const;

function registrationExportRow(
  row: RegistrationListItem,
  timeZone: string,
): string[] {
  return [
    row.phone,
    row.description ?? "",
    formatRegStatus(row.status),
    formatEndpoint(row.ip, row.port),
    row.country ?? "",
    row.city ?? "",
    row.isp ?? "",
    formatTimestamp(row.lastChangedAt, timeZone),
    formatTimestamp(row.lastSeenAt, timeZone),
  ];
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
  });
  const buffer = await workbookToBuffer(workbook);
  return {
    buffer,
    filename: `regs-${formatExportTimestamp(new Date(), timeZone)}.xlsx`,
  };
}
