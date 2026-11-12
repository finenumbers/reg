/**
 * Full «Управление РТУ» workbook. Thin borders.
 * The column set is always RTU_COLUMNS. The «Маски и типы» toggle does not change it.
 */

import { guardExcelText } from "@/modules/enrich/formula-guard";
import {
  createSimpleWorkbook,
  formatExportTimestamp,
  workbookToBuffer,
} from "@/lib/xlsx-export";
import { formatAmountCell } from "@/lib/amount-format";
import { geographyAbcText } from "@/modules/rtu/abc-display";
import { RTU_COLUMNS, RTU_HEADERS, rtuCellAlign } from "@/modules/rtu/columns";
import { geographyRowTone, type GeographyRowTone } from "@/modules/rtu/row-tone";
import { listAllRtu } from "@/modules/rtu/service";
import { getDisplayTimezone } from "@/modules/settings";

const TONE_FILL: Record<Exclude<GeographyRowTone, "none">, string> = {
  blocked: "FF000000",
  missing: "FFDC2626",
  unregistered: "FFFEE2E2",
  operator: "FFBFDBFE",
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

export type RtuExportResult = {
  buffer: Buffer;
  filename: string;
};

export async function buildRtuExportXlsx(): Promise<RtuExportResult> {
  const [items, timeZone] = await Promise.all([listAllRtu(), getDisplayTimezone()]);
  const headers = RTU_COLUMNS.map((column) => RTU_HEADERS[column]);
  const rows = items.map((item) =>
    RTU_COLUMNS.map((column) =>
      guardExcelText(
        column === "abc"
          ? geographyAbcText(item.number, item.abc, item.telephone)
          : column === "purchase" || column === "premium"
            ? formatAmountCell(item[column])
            : item[column],
      ),
    ),
  );
  const workbook = createSimpleWorkbook({
    sheetName: "Управление РТУ",
    headers,
    rows,
    styleCell: ({ rowIndex, colIndex, cell }) => {
      if (rowIndex < 0) return;
      const align = rtuCellAlign(RTU_COLUMNS[colIndex] ?? "category");
      if (align) {
        cell.numFmt = "@";
        cell.alignment = { horizontal: align, vertical: "middle" };
      }
      const item = items[rowIndex];
      if (!item) return;
      const tone = geographyRowTone(item, { surface: "export" });
      const fill = toneFill(tone);
      if (fill) cell.fill = fill;
      if (tone === "blocked" || tone === "missing") {
        const font = cell.font;
        cell.font = {
          name: font?.name ?? "Calibri",
          size: font?.size ?? 11,
          bold: Boolean(font?.bold),
          color: { argb: "FFFFFFFF" },
        };
      }
    },
  });
  const buffer = await workbookToBuffer(workbook);
  return {
    buffer,
    filename: `rtu-${formatExportTimestamp(new Date(), timeZone)}.xlsx`,
  };
}
