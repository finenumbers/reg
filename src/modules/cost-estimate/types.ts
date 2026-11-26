/**
 * Ephemeral cost-estimate workbook: input rows and rated output cells.
 */

import type { OprsOperatorTone } from "@/modules/oprs/operator-tone";
import type ExcelJS from "exceljs";

export const COST_ESTIMATE_INPUT_HEADERS = [
  "Дата",
  "A-номер",
  "B-номер",
  "Продолжительность",
] as const;

export const COST_ESTIMATE_OUTPUT_HEADERS = [
  "Дата",
  "A-номер",
  "B-номер",
  "Тип звонка",
  "Направление",
  "Регион",
  "Секунды",
  "Минуты",
  "Стоимость",
  "Сеть ОПРС",
  "Оператор связи (реестр МинЦифры)",
  "География нумерации (реестр МинЦифры)",
] as const;

/** 0-based column indexes in COST_ESTIMATE_OUTPUT_HEADERS. */
export const COST_ESTIMATE_COL = {
  aNumber: 1,
  bNumber: 2,
  seconds: 6,
  minutes: 7,
  charge: 8,
} as const;

export const COST_ESTIMATE_MAX_ROWS = 50_000;
export const COST_ESTIMATE_MAX_DETAILS = 30;
export const COST_ESTIMATE_SHEET_NAME = "Расчет затрат";
export const COST_ESTIMATE_FILENAME = "Расчет затрат.xlsx";

export const COST_ESTIMATE_TONE_ERROR =
  "Карта операторов ОПРС неполная, расчёт не выполнен.";

export const COST_ESTIMATE_PARSE_ERROR = "Файл XLSX не подходит для расчёта затрат";

/** «Стоимость» for Тип = Местный (not billed; excluded from the total). */
export const COST_ESTIMATE_LOCAL_CHARGE = "-";

/** Empty «Сеть ОПРС» for non-mobile rows (not registry-missing). */
export const COST_ESTIMATE_EMPTY_NETWORK = "-";

export type CostEstimateInputRow = {
  /** 1-based worksheet row (header is 1). */
  rowNumber: number;
  /** Display text preserved for the output Дата column (no GMT*). */
  dateDisplay: string;
  /** Original A-номер cell text; empty when the cell is blank. */
  aNumberRaw: string;
  /** Digits-only A for geography; empty when A is blank. */
  aDigits: string;
  /** Original B-номер cell text for the output. */
  bNumberRaw: string;
  /** Digits-only B for rating and PSTN. */
  bDigits: string;
  /** Non-negative integer seconds. */
  seconds: number;
};

export type CostEstimateOutputRow = {
  dateDisplay: string;
  aNumberRaw: string;
  bNumberRaw: string;
  callType: string;
  direction: string;
  region: string;
  seconds: number;
  minutes: number;
  /** Rater text with `.` decimals; empty when not charged. */
  charge: string;
  network: string;
  operator: string;
  geography: string;
  /** OPRS tone for mobile fill; null → no fill (including «Внешние сети»). */
  fillTone: OprsOperatorTone | null;
  /** Domestic type with no PSTN operator → black row, white font, МинЦифры label. */
  registryMissing: boolean;
};

export type CostEstimatePstnFields = {
  operator: string;
  geography: string;
};

export type CostEstimateRunOk = {
  ok: true;
  buffer: Buffer;
  filename: string;
  pstnSnapshotEmpty: boolean;
};

export type CostEstimateRunErr = {
  ok: false;
  status: 400 | 503;
  error: string;
  details: string[];
};

export type CostEstimateRunResult = CostEstimateRunOk | CostEstimateRunErr;

export type CostEstimateFill = ExcelJS.Fill;
