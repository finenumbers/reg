/**
 * Border roles matching the updated sample.xlsx group boxes.
 */

import type ExcelJS from "exceljs";
import {
  MISSING_BILLING_LABEL,
  MISSING_PSTN_LABEL,
} from "@/modules/enrich/types";

export type BorderRole =
  | "plain"
  | "noRight"
  | "noLeft"
  | "groupStart"
  | "groupMid"
  | "groupEnd"
  | "groupLastStart"
  | "groupLastMid"
  | "groupLastEnd"
  | "headerPlain"
  | "headerNoRight"
  | "headerNoLeft"
  | "headerGroupStart"
  | "headerGroupMid"
  | "headerGroupEnd";

export type SheetKind = "traffic" | "detail";

/** 0-based column → body role (non-last row). */
export function trafficBodyRole(col: number, lastRow: boolean): BorderRole {
  const map: Record<number, [BorderRole, BorderRole]> = {
    0: ["noRight", "noRight"],
    1: ["noRight", "noRight"],
    2: ["groupStart", "groupLastStart"],
    3: ["groupEnd", "groupLastEnd"],
    4: ["groupStart", "groupLastStart"],
    5: ["groupEnd", "groupLastEnd"],
    6: ["noLeft", "noLeft"],
  };
  const pair = map[col];
  if (pair) return lastRow ? pair[1] : pair[0];
  return "plain";
}

export function trafficHeaderRole(col: number): BorderRole {
  const map: Record<number, BorderRole> = {
    0: "headerNoRight",
    1: "headerNoRight",
    2: "headerGroupStart",
    3: "headerGroupEnd",
    4: "headerGroupStart",
    5: "headerGroupEnd",
    6: "headerNoLeft",
  };
  return map[col] ?? "headerPlain";
}

export function detailBodyRole(col: number, lastRow: boolean): BorderRole {
  const lastStart = lastRow ? "groupLastStart" : "groupStart";
  const lastMid = lastRow ? "groupLastMid" : "groupMid";
  const lastEnd = lastRow ? "groupLastEnd" : "groupEnd";
  switch (col) {
    case 0:
    case 1:
      return "noRight";
    case 2:
      return lastStart;
    case 3:
    case 4:
      return lastMid;
    case 5:
      return lastEnd;
    case 6:
      return lastStart;
    case 7:
    case 8:
      return lastMid;
    case 9:
      return lastEnd;
    case 10:
      return "noLeft";
    case 11:
    case 12:
    case 13:
      return "plain";
    case 14:
      return "noRight";
    case 15:
      return lastStart;
    case 16:
    case 17:
      return lastMid;
    case 18:
      return lastEnd;
    case 19:
      return lastStart;
    case 20:
    case 21:
      return lastMid;
    case 22:
      return lastEnd;
    default:
      return "plain";
  }
}

export function detailHeaderRole(col: number): BorderRole {
  switch (col) {
    case 0:
    case 1:
      return "headerNoRight";
    case 2:
      return "headerGroupStart";
    case 3:
    case 4:
      return "headerGroupMid";
    case 5:
      return "headerGroupEnd";
    case 6:
      return "headerGroupStart";
    case 7:
    case 8:
      return "headerGroupMid";
    case 9:
      return "headerGroupEnd";
    case 10:
      return "headerNoLeft";
    case 11:
    case 12:
    case 13:
      return "headerPlain";
    case 14:
      return "headerNoRight";
    case 15:
      return "headerGroupStart";
    case 16:
    case 17:
      return "headerGroupMid";
    case 18:
      return "headerGroupEnd";
    case 19:
      return "headerGroupStart";
    case 20:
    case 21:
      return "headerGroupMid";
    case 22:
      return "headerGroupEnd";
    default:
      return "headerPlain";
  }
}

export type MissFontRole = "blue" | "red" | null;

/** Same hues as trafficMissingLabelClass (blue-600 / red-600). */
export const XLSX_BILLING_FONT_ARGB = "FF2563EB";
export const XLSX_PSTN_FONT_ARGB = "FFDC2626";

export function xlsxMissFontRole(value: string): MissFontRole {
  if (value === MISSING_BILLING_LABEL) return "blue";
  if (value === MISSING_PSTN_LABEL) return "red";
  return null;
}

export const XLSX_PHANTOM_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD4D4D8" },
};

export const XLSX_CALL_ERROR_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFECACA" },
};
