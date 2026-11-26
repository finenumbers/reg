/**
 * Cost-estimate result workbook.
 */

import {
  createSimpleWorkbook,
  workbookToBuffer,
} from "@/lib/xlsx-export";
import { costEstimateFillForTone } from "@/modules/cost-estimate/fills";
import {
  COST_ESTIMATE_FILENAME,
  COST_ESTIMATE_OUTPUT_HEADERS,
  COST_ESTIMATE_SHEET_NAME,
  type CostEstimateOutputRow,
} from "@/modules/cost-estimate/types";

export async function writeCostEstimateXlsx(
  rows: readonly CostEstimateOutputRow[],
): Promise<{ buffer: Buffer; filename: string }> {
  const values = rows.map((row) => [
    row.dateDisplay,
    row.bNumberRaw,
    row.callType,
    row.direction,
    row.charge,
    row.network,
    row.operator,
    row.geography,
  ]);

  const workbook = createSimpleWorkbook({
    sheetName: COST_ESTIMATE_SHEET_NAME,
    headers: COST_ESTIMATE_OUTPUT_HEADERS,
    rows: values,
    styleCell: ({ rowIndex, cell }) => {
      cell.numFmt = "@";
      if (rowIndex < 0) return;
      const fill = costEstimateFillForTone(rows[rowIndex]?.fillTone ?? null);
      if (fill) cell.fill = fill;
    },
  });

  return {
    buffer: await workbookToBuffer(workbook),
    filename: COST_ESTIMATE_FILENAME,
  };
}
