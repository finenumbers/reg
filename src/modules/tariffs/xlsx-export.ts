/**
 * Tariff snapshot workbook. Cells are the import shape, in file order.
 * A Russian ABC keeps an empty digit-length cell: the screen shows 11,
 * and the importer does not read that cell.
 */

import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import {
  createSimpleWorkbook,
  formatExportTimestamp,
  workbookToBuffer,
} from "@/lib/xlsx-export";
import { guardExcelText } from "@/modules/enrich/formula-guard";
import { getDisplayTimezone } from "@/modules/settings";
import { formatTariffDecimal, TARIFF_HEADERS } from "@/modules/tariffs/parse-xlsx";
import { abcIgnoresDigitLengths } from "@/modules/traffic/tariff-match";

const TEXT_COLUMNS = new Set(["ABC", "Разрядность", "Нумерация"]);

export type TariffExportSource = {
  direction: string;
  region: string | null;
  abc: string;
  digitLengths: string | null;
  numbering: string | null;
  /** Canonical stored price, already passed through formatTariffDecimal. */
  price: string;
};

export function tariffExportCells(row: TariffExportSource): string[] {
  const digitLengths = abcIgnoresDigitLengths(row.abc) ? "" : (row.digitLengths ?? "");
  return [
    guardExcelText(row.direction),
    guardExcelText(row.region ?? ""),
    row.abc,
    digitLengths,
    row.numbering ?? "",
    row.price,
  ];
}

export function buildTariffExportWorkbook(
  rows: readonly TariffExportSource[],
): ExcelJS.Workbook {
  const headers = [...TARIFF_HEADERS];
  return createSimpleWorkbook({
    sheetName: "Тарифы",
    headers,
    rows: rows.map((row) => tariffExportCells(row)),
    styleCell: ({ rowIndex, colIndex, cell }) => {
      if (rowIndex < 0) return;
      const name = headers[colIndex];
      if (name && TEXT_COLUMNS.has(name)) cell.numFmt = "@";
    },
  });
}

export async function buildTariffExportXlsx(): Promise<{ buffer: Buffer; filename: string }> {
  const [rows, timeZone] = await Promise.all([
    prisma.tariffRate.findMany({
      orderBy: { sortIndex: "asc" },
      select: {
        direction: true,
        region: true,
        abc: true,
        digitLengths: true,
        numbering: true,
        price: true,
      },
    }),
    getDisplayTimezone(),
  ]);
  const buffer = await workbookToBuffer(
    buildTariffExportWorkbook(
      rows.map((row) => ({
        direction: row.direction,
        region: row.region,
        abc: row.abc,
        digitLengths: row.digitLengths,
        numbering: row.numbering,
        price: formatTariffDecimal(row.price.toString()),
      })),
    ),
  );
  return {
    buffer,
    filename: `tariffs-${formatExportTimestamp(new Date(), timeZone)}.xlsx`,
  };
}
