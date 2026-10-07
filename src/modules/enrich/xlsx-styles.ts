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

/** 0-based column → body role (non-last row). Category, type, and status sit at 2–4. */
export function trafficBodyRole(col: number, lastRow: boolean): BorderRole {
  const map: Record<number, [BorderRole, BorderRole]> = {
    0: ["noRight", "noRight"],
    1: ["noRight", "noRight"],
    5: ["groupStart", "groupLastStart"],
    6: ["groupEnd", "groupLastEnd"],
    7: ["groupStart", "groupLastStart"],
    8: ["groupEnd", "groupLastEnd"],
    9: ["groupStart", "groupStart"],
  };
  const pair = map[col];
  if (pair) return lastRow ? pair[1] : pair[0];
  return "plain";
}

export function trafficHeaderRole(col: number): BorderRole {
  const map: Record<number, BorderRole> = {
    0: "headerNoRight",
    1: "headerNoRight",
    5: "headerGroupStart",
    6: "headerGroupEnd",
    7: "headerGroupStart",
    8: "headerGroupEnd",
    9: "groupStart",
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
    case 5:
      return lastStart;
    case 6:
    case 7:
      return lastMid;
    case 8:
      return lastEnd;
    case 9:
      return lastStart;
    case 10:
    case 11:
      return lastMid;
    case 12:
      return lastEnd;
    case 13:
      return "noLeft";
    case 14:
    case 15:
    case 16:
      return "plain";
    case 17:
      return "noRight";
    case 18:
      return lastStart;
    case 19:
    case 20:
      return lastMid;
    case 21:
      return lastEnd;
    case 22:
      return lastStart;
    case 23:
    case 24:
      return lastMid;
    case 25:
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
    case 5:
      return "headerGroupStart";
    case 6:
    case 7:
      return "headerGroupMid";
    case 8:
      return "headerGroupEnd";
    case 9:
      return "headerGroupStart";
    case 10:
    case 11:
      return "headerGroupMid";
    case 12:
      return "headerGroupEnd";
    case 13:
      return "headerNoLeft";
    case 14:
    case 15:
    case 16:
      return "headerPlain";
    case 17:
      return "headerNoRight";
    case 18:
      return "headerGroupStart";
    case 19:
    case 20:
      return "headerGroupMid";
    case 21:
      return "headerGroupEnd";
    case 22:
      return "headerGroupStart";
    case 23:
    case 24:
      return "headerGroupMid";
    case 25:
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

/** Tailwind green-200 — category «Фантомный». */
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

/** Tailwind purple-200 — category «Проверить». */
export const XLSX_VERIFY_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE9D5FF" },
};

/** Tailwind yellow-200 — successful category «Проверка». */
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
