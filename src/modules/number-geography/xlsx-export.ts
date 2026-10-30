/**
 * Full «География номеров» workbook. Same columns as the screen, thin borders.
 */

import { guardExcelText } from "@/modules/enrich/formula-guard";
import {
  createSimpleWorkbook,
  formatExportTimestamp,
  workbookToBuffer,
  XLSX_UNREGISTERED_FILL,
} from "@/lib/xlsx-export";
import {
  NUMBER_GEOGRAPHY_COLUMNS,
  NUMBER_GEOGRAPHY_HEADERS,
} from "@/modules/number-geography/columns";
import { listAllNumberGeography } from "@/modules/number-geography/service";
import { getDisplayTimezone } from "@/modules/settings";

export type NumberGeographyExportResult = {
  buffer: Buffer;
  filename: string;
};

export async function buildNumberGeographyExportXlsx(): Promise<NumberGeographyExportResult> {
  const [items, timeZone] = await Promise.all([
    listAllNumberGeography(),
    getDisplayTimezone(),
  ]);
  const headers = NUMBER_GEOGRAPHY_COLUMNS.map(
    (column) => NUMBER_GEOGRAPHY_HEADERS[column],
  );
  const rows = items.map((item) =>
    NUMBER_GEOGRAPHY_COLUMNS.map((column) => guardExcelText(item[column])),
  );
  const workbook = createSimpleWorkbook({
    sheetName: "География номеров",
    headers,
    rows,
    highlightFill: XLSX_UNREGISTERED_FILL,
    highlightRow: (index) => items[index]?.cityAlert === true,
  });
  const buffer = await workbookToBuffer(workbook);
  return {
    buffer,
    filename: `number-geography-${formatExportTimestamp(new Date(), timeZone)}.xlsx`,
  };
}
