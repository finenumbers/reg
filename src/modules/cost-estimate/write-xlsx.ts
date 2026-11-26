/**
 * Cost-estimate result workbook.
 * Data rows: numeric phones/seconds/minutes/charge. Footer total is a green numeric charge cell.
 */

import type ExcelJS from "exceljs";
import {
  columnWidthForValues,
  createSimpleWorkbook,
  workbookToBuffer,
} from "@/lib/xlsx-export";
import {
  XLSX_COST_ESTIMATE_TOTAL_FILL,
  costEstimateRowFill,
} from "@/modules/cost-estimate/fills";
import { digitsFromE164 } from "@/modules/cost-estimate/normalize";
import {
  chargeToExcelNumber,
  formatCostEstimateTotal,
  sumChargeKopecks,
} from "@/modules/cost-estimate/total-format";
import {
  COST_ESTIMATE_COL,
  COST_ESTIMATE_FILENAME,
  COST_ESTIMATE_LOCAL_CHARGE,
  COST_ESTIMATE_OUTPUT_HEADERS,
  COST_ESTIMATE_SHEET_NAME,
  type CostEstimateOutputRow,
} from "@/modules/cost-estimate/types";
import { CALL_TYPE } from "@/modules/traffic/call-class";

const BODY_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: false,
  color: { argb: "FF000000" },
};

const HEADER_ALIGN: Partial<ExcelJS.Alignment> = {
  horizontal: "center",
  vertical: "middle",
};

const TOTAL_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "medium", color: { argb: "FF000000" } },
  left: { style: "medium", color: { argb: "FF000000" } },
  bottom: { style: "medium", color: { argb: "FF000000" } },
  right: { style: "medium", color: { argb: "FF000000" } },
};

const PHONE_DIGITS_RE = /^\d{10,15}$/;

function costEstimateDataAlign(
  colIndex: number,
): Partial<ExcelJS.Alignment> {
  const right =
    colIndex === COST_ESTIMATE_COL.seconds ||
    colIndex === COST_ESTIMATE_COL.minutes ||
    colIndex === COST_ESTIMATE_COL.charge;
  return {
    horizontal: right ? "right" : "left",
    vertical: "middle",
  };
}

/** Digits as Excel number with numFmt 0, or text/@ when empty/unusable. */
export function writePhoneCell(cell: ExcelJS.Cell, raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed) {
    cell.value = "";
    cell.numFmt = "@";
    return;
  }
  const digits = digitsFromE164(trimmed);
  if (PHONE_DIGITS_RE.test(digits)) {
    const n = Number(digits);
    if (Number.isSafeInteger(n)) {
      cell.value = n;
      cell.numFmt = "0";
      return;
    }
  }
  cell.value = raw;
  cell.numFmt = "@";
}

export async function writeCostEstimateXlsx(
  rows: readonly CostEstimateOutputRow[],
): Promise<{ buffer: Buffer; filename: string }> {
  const values = rows.map((row) => [
    row.dateDisplay,
    row.aNumberRaw,
    row.bNumberRaw,
    row.callType,
    row.direction,
    row.region,
    String(row.seconds),
    String(row.minutes),
    row.charge,
    row.network,
    row.operator,
    row.geography,
  ]);

  const workbook = createSimpleWorkbook({
    sheetName: COST_ESTIMATE_SHEET_NAME,
    headers: COST_ESTIMATE_OUTPUT_HEADERS,
    rows: values,
    styleCell: ({ rowIndex, colIndex, cell }) => {
      if (rowIndex < 0) {
        cell.numFmt = "@";
        cell.alignment = { ...HEADER_ALIGN };
        return;
      }
      const row = rows[rowIndex];
      if (!row) return;

      const fill = costEstimateRowFill(row);
      if (fill) cell.fill = fill;

      cell.font = {
        name: "Calibri",
        size: 11,
        bold: row.callType === CALL_TYPE.mobile,
        color: {
          argb: row.registryMissing ? "FFFFFFFF" : "FF000000",
        },
      };
      cell.alignment = costEstimateDataAlign(colIndex);

      if (colIndex === COST_ESTIMATE_COL.aNumber) {
        writePhoneCell(cell, row.aNumberRaw);
        return;
      }
      if (colIndex === COST_ESTIMATE_COL.bNumber) {
        writePhoneCell(cell, row.bNumberRaw);
        return;
      }
      if (colIndex === COST_ESTIMATE_COL.seconds) {
        cell.value = row.seconds;
        cell.numFmt = "#,##0";
        return;
      }
      if (colIndex === COST_ESTIMATE_COL.minutes) {
        cell.value = row.minutes;
        cell.numFmt = "#,##0";
        return;
      }
      if (colIndex === COST_ESTIMATE_COL.charge) {
        if (row.charge === COST_ESTIMATE_LOCAL_CHARGE) {
          cell.value = COST_ESTIMATE_LOCAL_CHARGE;
          cell.numFmt = "@";
          return;
        }
        const n = chargeToExcelNumber(row.charge);
        if (n == null) {
          cell.value = "";
          cell.numFmt = "@";
          return;
        }
        cell.value = n;
        cell.numFmt = "#,##0.00";
        return;
      }
      cell.numFmt = "@";
    },
  });

  const sheet = workbook.getWorksheet(COST_ESTIMATE_SHEET_NAME);
  if (!sheet) {
    throw new Error("cost-estimate sheet missing");
  }

  const sumKopecks = sumChargeKopecks(rows.map((row) => row.charge));
  const totalNumber = Number(sumKopecks) / 100;
  const totalDisplay = formatCostEstimateTotal(sumKopecks);
  const totalPlaceholders = COST_ESTIMATE_OUTPUT_HEADERS.map(() => "");
  const totalExcelRow = sheet.addRow(totalPlaceholders);
  for (let c = 1; c <= COST_ESTIMATE_OUTPUT_HEADERS.length; c++) {
    const cell = totalExcelRow.getCell(c);
    cell.numFmt = "@";
    cell.alignment = costEstimateDataAlign(c - 1);
    if (c - 1 === COST_ESTIMATE_COL.charge) {
      cell.value = totalNumber;
      cell.numFmt = "#,##0.00";
      cell.fill = XLSX_COST_ESTIMATE_TOTAL_FILL;
      cell.border = { ...TOTAL_BORDER };
      cell.font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: "FF000000" },
      };
    } else {
      cell.value = "";
      cell.font = { ...BODY_FONT };
    }
  }

  const chargeHeader = COST_ESTIMATE_OUTPUT_HEADERS[COST_ESTIMATE_COL.charge]!;
  const chargeCol = sheet.getColumn(COST_ESTIMATE_COL.charge + 1);
  const chargeWidth = columnWidthForValues(chargeHeader, [
    ...rows.map((row) => row.charge),
    totalDisplay,
  ]);
  chargeCol.width = Math.max(Number(chargeCol.width) || 0, chargeWidth);

  // Keep autoFilter on data only (header + data rows). Total stays outside.
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: {
      row: Math.max(1, rows.length + 1),
      column: COST_ESTIMATE_OUTPUT_HEADERS.length,
    },
  };

  return {
    buffer: await workbookToBuffer(workbook),
    filename: COST_ESTIMATE_FILENAME,
  };
}
