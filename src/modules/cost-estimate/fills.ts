/**
 * OPRS network row fills for the cost-estimate workbook.
 * ARGB matches Tailwind *-200 used on «Звонки в ОПРС».
 */

import type ExcelJS from "exceljs";
import type { OprsOperatorTone } from "@/modules/oprs/operator-tone";

/** Tailwind red-200 — «МТС». */
export const XLSX_OPRS_MTS_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFECACA" },
};

/** Tailwind green-200 — «Мегафон». */
export const XLSX_OPRS_MEGAFON_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFBBF7D0" },
};

/** Tailwind yellow-200 — «Билайн». */
export const XLSX_OPRS_BEELINE_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFEF08A" },
};

/** Tailwind gray-200 — «Т2». */
export const XLSX_OPRS_T2_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE5E7EB" },
};

/** Black fill — domestic row with no PSTN operator (white font in write-xlsx). */
export const XLSX_REGISTRY_MISSING_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF000000" },
};

export function costEstimateFillForTone(
  tone: OprsOperatorTone | null,
): ExcelJS.Fill | undefined {
  switch (tone) {
    case "red":
      return XLSX_OPRS_MTS_FILL;
    case "green":
      return XLSX_OPRS_MEGAFON_FILL;
    case "yellow":
      return XLSX_OPRS_BEELINE_FILL;
    case "gray":
      return XLSX_OPRS_T2_FILL;
    default:
      return undefined;
  }
}

export function costEstimateRowFill(row: {
  registryMissing: boolean;
  fillTone: OprsOperatorTone | null;
}): ExcelJS.Fill | undefined {
  if (row.registryMissing) return XLSX_REGISTRY_MISSING_FILL;
  return costEstimateFillForTone(row.fillTone);
}
