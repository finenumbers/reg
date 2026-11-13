/**
 * Marking snapshot workbook. Cells are the import shape, in file order.
 */

import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import {
  createSimpleWorkbook,
  formatExportTimestamp,
  workbookToBuffer,
} from "@/lib/xlsx-export";
import { guardExcelText } from "@/modules/enrich/formula-guard";
import { MARKING_HEADERS } from "@/modules/marking/parse-xlsx";
import { getDisplayTimezone } from "@/modules/settings";

export type MarkingExportSource = {
  client: string;
  phoneNumber: string;
  labelMts: string | null;
  labelMegafon: string | null;
  labelBeeline: string | null;
  labelT2: string | null;
  mavMts: string | null;
  mavMegafon: string | null;
  mavBeeline: string | null;
  mavT2: string | null;
};

export function markingExportCells(row: MarkingExportSource): string[] {
  return [
    guardExcelText(row.client),
    row.phoneNumber,
    guardExcelText(row.labelMts ?? ""),
    guardExcelText(row.labelMegafon ?? ""),
    guardExcelText(row.labelBeeline ?? ""),
    guardExcelText(row.labelT2 ?? ""),
    guardExcelText(row.mavMts ?? ""),
    guardExcelText(row.mavMegafon ?? ""),
    guardExcelText(row.mavBeeline ?? ""),
    guardExcelText(row.mavT2 ?? ""),
  ];
}

export function buildMarkingExportWorkbook(
  rows: readonly MarkingExportSource[],
): ExcelJS.Workbook {
  const headers = [...MARKING_HEADERS];
  return createSimpleWorkbook({
    sheetName: "Маркировка и МАВ",
    headers,
    rows: rows.map((row) => markingExportCells(row)),
    styleCell: ({ rowIndex, colIndex, cell }) => {
      if (rowIndex < 0) return;
      if (headers[colIndex] === "Номер") cell.numFmt = "@";
    },
  });
}

export async function buildMarkingExportXlsx(): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const [rows, timeZone] = await Promise.all([
    prisma.markingRow.findMany({
      orderBy: { sortIndex: "asc" },
      select: {
        client: true,
        phoneNumber: true,
        labelMts: true,
        labelMegafon: true,
        labelBeeline: true,
        labelT2: true,
        mavMts: true,
        mavMegafon: true,
        mavBeeline: true,
        mavT2: true,
      },
    }),
    getDisplayTimezone(),
  ]);
  const buffer = await workbookToBuffer(buildMarkingExportWorkbook(rows));
  return {
    buffer,
    filename: `marking-${formatExportTimestamp(new Date(), timeZone)}.xlsx`,
  };
}
