/**
 * Mask snapshot workbook. Cells are the import shape, in file order.
 */

import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import {
  createSimpleWorkbook,
  formatExportTimestamp,
  workbookToBuffer,
} from "@/lib/xlsx-export";
import { guardExcelText } from "@/modules/enrich/formula-guard";
import { MASK_HEADERS } from "@/modules/masks/parse-xlsx";
import { getDisplayTimezone } from "@/modules/settings";

const TEXT_COLUMNS = new Set(["Разрядность", "ABC", "Маска"]);

export type MaskExportSource = {
  digitLength: number;
  category: string;
  abc: string | null;
  mask: string;
  maskType: string | null;
  premium: string | null;
  purchase: string | null;
};

export function maskExportCells(row: MaskExportSource): string[] {
  return [
    String(row.digitLength),
    guardExcelText(row.category),
    row.abc ?? "",
    row.mask,
    guardExcelText(row.maskType ?? ""),
    guardExcelText(row.purchase ?? ""),
    guardExcelText(row.premium ?? ""),
  ];
}

export function buildMaskExportWorkbook(rows: readonly MaskExportSource[]): ExcelJS.Workbook {
  const headers = [...MASK_HEADERS];
  return createSimpleWorkbook({
    sheetName: "Маски",
    headers,
    rows: rows.map((row) => maskExportCells(row)),
    styleCell: ({ rowIndex, colIndex, cell }) => {
      if (rowIndex < 0) return;
      const name = headers[colIndex];
      if (name && TEXT_COLUMNS.has(name)) cell.numFmt = "@";
    },
  });
}

export async function buildMaskExportXlsx(): Promise<{ buffer: Buffer; filename: string }> {
  const [rows, timeZone] = await Promise.all([
    prisma.numberMask.findMany({
      orderBy: { sortIndex: "asc" },
      select: {
        digitLength: true,
        category: true,
        abc: true,
        mask: true,
        maskType: true,
        premium: true,
        purchase: true,
      },
    }),
    getDisplayTimezone(),
  ]);
  const buffer = await workbookToBuffer(buildMaskExportWorkbook(rows));
  return { buffer, filename: `masks-${formatExportTimestamp(new Date(), timeZone)}.xlsx` };
}
