/**
 * Border roles matching the updated sample.xlsx group boxes.
 */

import type ExcelJS from "exceljs";
import { MISSING_BILLING_LABEL, MISSING_PSTN_LABEL } from "@/modules/enrich/types";

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

/** 0-based column → body role (non-last row). Category and status sit at 2–3. */
export function trafficBodyRole(col: number, lastRow: boolean): BorderRole {
  const map: Record<number, [BorderRole, BorderRole]> = {
    0: ["noRight", "noRight"],
    1: ["noRight", "noRight"],
    4: ["groupStart", "groupLastStart"],
    5: ["groupEnd", "groupLastEnd"],
    6: ["groupStart", "groupLastStart"],
    7: ["groupEnd", "groupLastEnd"],
    8: ["noLeft", "noLeft"],
  };
  const pair = map[col];
  if (pair) return lastRow ? pair[1] : pair[0];
  return "plain";
}

export function trafficHeaderRole(col: number): BorderRole {
  const map: Record<number, BorderRole> = {
    0: "headerNoRight",
    1: "headerNoRight",
    4: "headerGroupStart",
    5: "headerGroupEnd",
    6: "headerGroupStart",
    7: "headerGroupEnd",
    8: "headerNoLeft",
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
    case 4:
      return lastStart;
    case 5:
    case 6:
      return lastMid;
    case 7:
      return lastEnd;
    case 8:
      return lastStart;
    case 9:
    case 10:
      return lastMid;
    case 11:
      return lastEnd;
    case 12:
      return "noLeft";
    case 13:
    case 14:
    case 15:
      return "plain";
    case 16:
      return "noRight";
    case 17:
      return lastStart;
    case 18:
    case 19:
      return lastMid;
    case 20:
      return lastEnd;
    case 21:
      return lastStart;
    case 22:
    case 23:
      return lastMid;
    case 24:
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
    case 4:
      return "headerGroupStart";
    case 5:
    case 6:
      return "headerGroupMid";
    case 7:
      return "headerGroupEnd";
    case 8:
      return "headerGroupStart";
    case 9:
    case 10:
      return "headerGroupMid";
    case 11:
      return "headerGroupEnd";
    case 12:
      return "headerNoLeft";
    case 13:
    case 14:
    case 15:
      return "headerPlain";
    case 16:
      return "headerNoRight";
    case 17:
      return "headerGroupStart";
    case 18:
    case 19:
      return "headerGroupMid";
    case 20:
      return "headerGroupEnd";
    case 21:
      return "headerGroupStart";
    case 22:
    case 23:
      return "headerGroupMid";
    case 24:
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

/** Tailwind green-200 — category «Фантомный трафик». */
export const XLSX_PHANTOM_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFBBF7D0" },
};

/** Tailwind red-200 — «Ошибка маршрута» and «Нет регистрации». */
export const XLSX_CALL_ERROR_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFECACA" },
};

/** Tailwind blue-200 — incoming and outgoing parking. */
export const XLSX_PARKING_KNOWN_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFBFDBFE" },
};

/** Tailwind yellow-200 — category «Проверка». */
export const XLSX_CHECK_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFEF08A" },
};

/** Tailwind gray-200 — status «Неуспешный» when the category has no color. */
export const XLSX_FAILED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE5E7EB" },
};
