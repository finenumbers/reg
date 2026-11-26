/**
 * Cost-estimate result workbook.
 * Data rows: numeric seconds/minutes/charge. Footer total is bold text outside autoFilter.
 */

import type ExcelJS from "exceljs";
import {
  createSimpleWorkbook,
  workbookToBuffer,
} from "@/lib/xlsx-export";
import { costEstimateRowFill } from "@/modules/cost-estimate/fills";
import {
  chargeToExcelNumber,
  formatCostEstimateTotal,
  sumChargeKopecks,
} from "@/modules/cost-estimate/total-format";
import {
  COST_ESTIMATE_COL,
  COST_ESTIMATE_FILENAME,
  COST_ESTIMATE_OUTPUT_HEADERS,
  COST_ESTIMATE_SHEET_NAME,
  type CostEstimateOutputRow,
} from "@/modules/cost-estimate/types";
import { CALL_TYPE } from "@/modules/traffic/call-class";

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

const BODY_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: false,
  color: { argb: "FF000000" },
};

const MOBILE_BOLD_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: true,
  color: { argb: "FF000000" },
};

export async function writeCostEstimateXlsx(
  rows: readonly CostEstimateOutputRow[],
): Promise<{ buffer: Buffer; filename: string }> {
  const values = rows.map((row) => [
    row.dateDisplay,
    row.aNumberRaw,
    row.bNumberRaw,
    row.callType,
    row.direction,
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
        return;
      }
      const row = rows[rowIndex];
      if (!row) return;

      const fill = costEstimateRowFill(row);
      if (fill) cell.fill = fill;

      if (row.callType === CALL_TYPE.mobile) {
        cell.font = { ...MOBILE_BOLD_FONT };
      }

      if (colIndex === COST_ESTIMATE_COL.seconds) {
        cell.value = row.seconds;
        cell.numFmt = "0";
        return;
      }
      if (colIndex === COST_ESTIMATE_COL.minutes) {
        cell.value = row.minutes;
        cell.numFmt = "0";
        return;
      }
      if (colIndex === COST_ESTIMATE_COL.charge) {
        const n = chargeToExcelNumber(row.charge);
        if (n == null) {
          cell.value = "";
          cell.numFmt = "@";
          return;
        }
        cell.value = n;
        cell.numFmt = "0.00";
        return;
      }
      cell.numFmt = "@";
    },
  });

  const sheet = workbook.getWorksheet(COST_ESTIMATE_SHEET_NAME);
  if (!sheet) {
    throw new Error("cost-estimate sheet missing");
  }

  const totalText = formatCostEstimateTotal(
    sumChargeKopecks(rows.map((row) => row.charge)),
  );
  const totalPlaceholders = COST_ESTIMATE_OUTPUT_HEADERS.map(() => "");
  totalPlaceholders[COST_ESTIMATE_COL.charge] = totalText;
  const totalExcelRow = sheet.addRow(totalPlaceholders);
  for (let c = 1; c <= COST_ESTIMATE_OUTPUT_HEADERS.length; c++) {
    const cell = totalExcelRow.getCell(c);
    cell.border = { ...THIN_BORDER };
    cell.numFmt = "@";
    if (c - 1 === COST_ESTIMATE_COL.charge) {
      cell.value = totalText;
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
