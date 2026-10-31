/**
 * Full «География номеров» workbook. Same columns as the screen, thin borders.
 */

import { guardExcelText } from "@/modules/enrich/formula-guard";
import {
  createSimpleWorkbook,
  formatExportTimestamp,
  workbookToBuffer,
} from "@/lib/xlsx-export";
import {
  NUMBER_GEOGRAPHY_COLUMNS,
  NUMBER_GEOGRAPHY_HEADERS,
} from "@/modules/number-geography/columns";
import {
  geographyRowTone,
  type GeographyRowTone,
} from "@/modules/number-geography/row-tone";
import { listAllNumberGeography } from "@/modules/number-geography/service";
import { getDisplayTimezone } from "@/modules/settings";

const TONE_FILL: Record<Exclude<GeographyRowTone, "none">, string> = {
  red: "FFFEE2E2",
  yellow: "FFFEF3C7",
  blue: "FFDBEAFE",
};

function toneFill(tone: GeographyRowTone) {
  if (tone === "none") return undefined;
  return {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: TONE_FILL[tone] },
  };
}

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
    styleCell: ({ rowIndex, cell }) => {
      if (rowIndex < 0) return;
      const item = items[rowIndex];
      if (!item) return;
      const fill = toneFill(geographyRowTone(item, { surface: "export" }));
      if (fill) cell.fill = fill;
    },
  });
  const buffer = await workbookToBuffer(workbook);
  return {
    buffer,
    filename: `number-geography-${formatExportTimestamp(new Date(), timeZone)}.xlsx`,
  };
}
