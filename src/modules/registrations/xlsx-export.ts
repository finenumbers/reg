/**
 * Build registrations list XLSX (full table, no filters).
 */

import {
  createSimpleWorkbook,
  formatExportTimestamp,
  workbookToBuffer,
} from "@/lib/xlsx-export";
import { loadAllRegistrationItems } from "@/modules/registrations/service";
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
  "lastChangedAt",
  "lastSeenAt",
] as const;

function registrationExportRow(row: RegistrationListItem): string[] {
  return [
    row.phone,
    row.description ?? "",
    formatRegStatus(row.status),
    formatEndpoint(row.ip, row.port),
    formatTimestamp(row.lastChangedAt),
    formatTimestamp(row.lastSeenAt),
  ];
}

export type RegsExportResult = {
  buffer: Buffer;
  filename: string;
};

export async function buildRegsExportXlsx(): Promise<RegsExportResult> {
  const items = await loadAllRegistrationItems();
  const headers = REG_EXPORT_COLUMNS.map((key) => REG_COLUMN_HEADERS[key]!);
  const rows = items.map(registrationExportRow);
  const workbook = createSimpleWorkbook({
    sheetName: "Регистрации",
    headers,
    rows,
  });
  const buffer = await workbookToBuffer(workbook);
  return {
    buffer,
    filename: `regs-${formatExportTimestamp()}.xlsx`,
  };
}
