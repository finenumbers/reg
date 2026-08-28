/**
 * Border roles matching the updated sample.xlsx group boxes.
 */

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
    1: ["groupStart", "groupLastStart"],
    2: ["groupEnd", "groupLastEnd"],
    3: ["groupStart", "groupLastStart"],
    4: ["groupEnd", "groupLastEnd"],
    5: ["noLeft", "noLeft"],
  };
  const pair = map[col];
  if (pair) return lastRow ? pair[1] : pair[0];
  return "plain";
}

export function trafficHeaderRole(col: number): BorderRole {
  const map: Record<number, BorderRole> = {
    0: "headerNoRight",
    1: "headerGroupStart",
    2: "headerGroupEnd",
    3: "headerGroupStart",
    4: "headerGroupEnd",
    5: "headerNoLeft",
  };
  return map[col] ?? "headerPlain";
}

export function detailBodyRole(col: number, lastRow: boolean): BorderRole {
  const lastStart = lastRow ? "groupLastStart" : "groupStart";
  const lastMid = lastRow ? "groupLastMid" : "groupMid";
  const lastEnd = lastRow ? "groupLastEnd" : "groupEnd";
  switch (col) {
    case 0:
      return "noRight";
    case 1:
      return lastStart;
    case 2:
    case 3:
      return lastMid;
    case 4:
      return lastEnd;
    case 5:
      return lastStart;
    case 6:
    case 7:
      return lastMid;
    case 8:
      return lastEnd;
    case 9:
      return "noLeft";
    case 10:
    case 11:
    case 12:
      return "plain";
    case 13:
      return "noRight";
    case 14:
      return lastStart;
    case 15:
    case 16:
      return lastMid;
    case 17:
      return lastEnd;
    case 18:
      return lastStart;
    case 19:
    case 20:
      return lastMid;
    case 21:
      return lastEnd;
    default:
      return "plain";
  }
}

export function detailHeaderRole(col: number): BorderRole {
  switch (col) {
    case 0:
      return "headerNoRight";
    case 1:
      return "headerGroupStart";
    case 2:
    case 3:
      return "headerGroupMid";
    case 4:
      return "headerGroupEnd";
    case 5:
      return "headerGroupStart";
    case 6:
    case 7:
      return "headerGroupMid";
    case 8:
      return "headerGroupEnd";
    case 9:
      return "headerNoLeft";
    case 10:
    case 11:
    case 12:
      return "headerPlain";
    case 13:
      return "headerNoRight";
    case 14:
      return "headerGroupStart";
    case 15:
    case 16:
      return "headerGroupMid";
    case 17:
      return "headerGroupEnd";
    case 18:
      return "headerGroupStart";
    case 19:
    case 20:
      return "headerGroupMid";
    case 21:
      return "headerGroupEnd";
    default:
      return "headerPlain";
  }
}

export type MissFontRole = "yellow" | "red" | null;

/** Same hues as trafficMissingLabelClass (yellow-600 / red-600). */
export const XLSX_BILLING_FONT_ARGB = "FFCA8A04";
export const XLSX_PSTN_FONT_ARGB = "FFDC2626";

export function xlsxMissFontRole(value: string): MissFontRole {
  if (value === MISSING_BILLING_LABEL) return "yellow";
  if (value === MISSING_PSTN_LABEL) return "red";
  return null;
}
