/**
 * Working SMG table. Same stored CDR row as the full dump.
 * Дата / Время are the call start. The month and the list order stay on disconnect.
 */

import { formatCount } from "@/lib/format-count";
import { billableMinutes } from "@/modules/enrich/types";
import { isSmgField, type SmgField } from "@/modules/smg/columns";
import {
  AF_CATEGORY,
  AF_STATUS,
  isSmgAntifraudColumn,
  SMG_ANTIFRAUD_COLUMNS,
  SMG_RADIUS_DELAY_COLUMNS,
  type SmgRadiusDelayColumn,
} from "@/modules/smg-trace/classify";
import { formatCdrDayDisplay, splitCdrDateParts } from "@/modules/traffic/cdr-date-parts";

/** Same predicate as `smgDurationSecondsSql`. Anything else is 0 seconds. */
const DURATION_DIGITS = /^[0-9]{1,18}$/;

const EMPTY_ANSWER = "—";

export const SMG_SUMMARY_DERIVED = [
  "setupDay",
  "setupClock",
  "connectClock",
  "disconnectClock",
  "redirectNumber",
  "billableMinutes",
] as const;

export type SmgSummaryDerived = (typeof SMG_SUMMARY_DERIVED)[number];

export const SMG_SUMMARY_COLUMNS = [
  "setupDay",
  "setupClock",
  "connectClock",
  "disconnectClock",
  "incomingCgpn",
  "outgoingCgpn",
  "incomingCdpn",
  "outgoingCdpn",
  "redirectNumber",
  "duration",
  "billableMinutes",
  "incomingDescription",
  "outgoingDescription",
  "releaseCause",
  "callReleaseInfo",
  "releaseSideMark",
  ...SMG_ANTIFRAUD_COLUMNS,
] as const;

export type SmgSummaryColumn = (typeof SMG_SUMMARY_COLUMNS)[number];

export const SMG_SUMMARY_LABELS: Record<SmgSummaryColumn, string> = {
  setupDay: "Дата",
  setupClock: "Время",
  connectClock: "Ответ",
  disconnectClock: "Отбой",
  incomingCgpn: "А вход",
  outgoingCgpn: "А выход",
  incomingCdpn: "Б вход",
  outgoingCdpn: "Б выход",
  redirectNumber: "Переадресация",
  duration: "Секунды",
  billableMinutes: "Минуты",
  incomingDescription: "Вход",
  outgoingDescription: "Выход",
  releaseCause: "Q.850",
  callReleaseInfo: "Статус",
  releaseSideMark: "Сброс",
  antifraud: "АнтиФрод",
  antifraudStatus: "Статус АнтиФрод",
  afDelay1Dev: "Вход Dev",
  afDelay1Prod: "Вход Prod",
  afDelay2Dev: "Выход Dev",
  afDelay2Prod: "Выход Prod",
  afDelayParking: "Parking",
};

/**
 * Phone-search paint on «Трафик SMG». Not the columns the query searches.
 */
export const SMG_SUMMARY_HIGHLIGHT_COLUMNS = [
  "outgoingCgpn",
  "outgoingCdpn",
  "redirectNumber",
] as const satisfies readonly SmgSummaryColumn[];

/**
 * Facet menus on the working table. Clocks, seconds, and minutes stay out:
 * a duration groups the whole gateway-month.
 * «Дата» is the start day, not the disconnect day that selects the month.
 */
export const SMG_SUMMARY_FACET_COLUMNS = [
  "setupDay",
  "incomingCgpn",
  "outgoingCgpn",
  "incomingCdpn",
  "outgoingCdpn",
  "redirectNumber",
  "incomingDescription",
  "outgoingDescription",
  "releaseCause",
  "callReleaseInfo",
  "releaseSideMark",
  "antifraud",
  "antifraudStatus",
] as const;

const DERIVED_SET = new Set<string>(SMG_SUMMARY_DERIVED);

export function isSmgSummaryDerived(column: string): column is SmgSummaryDerived {
  return DERIVED_SET.has(column);
}

type ClockSource = {
  setupTime: string;
  connectTime: string;
  disconnectTime: string;
  duration: string;
  incomingRedirectingNumber: string;
  outgoingRedirectingNumber: string;
  antifraud?: string;
  antifraudStatus?: string;
  afDelay1Dev?: string;
  afDelay1Prod?: string;
  afDelay2Dev?: string;
  afDelay2Prod?: string;
  afDelayParking?: string;
};

function legClock(raw: string, setupDay: string, empty: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return empty;
  const parts = splitCdrDateParts(trimmed);
  if (!parts.day || !parts.time) return trimmed;
  if (!setupDay || parts.day !== setupDay) {
    return `${formatCdrDayDisplay(parts.day)} ${parts.time}`;
  }
  return parts.time;
}

/** Billable minutes for one SMG `duration` string. Non-numeric and unsafe integers are 0. */
export function smgBillableMinutesCell(duration: string): string {
  const trimmed = duration.trim();
  if (!DURATION_DIGITS.test(trimmed)) return formatCount(0);
  const seconds = Number(trimmed);
  if (!Number.isSafeInteger(seconds)) return formatCount(0);
  return formatCount(billableMinutes(seconds));
}

export function formatSmgSummaryCell(
  column: SmgSummaryDerived,
  row: ClockSource,
): string {
  const setup = splitCdrDateParts(row.setupTime);
  switch (column) {
    case "setupDay":
      return setup.day ? formatCdrDayDisplay(setup.day) : "";
    case "setupClock": {
      const trimmed = row.setupTime.trim();
      if (!trimmed) return "";
      if (!setup.time) return trimmed;
      return setup.time;
    }
    case "connectClock":
      return legClock(row.connectTime, setup.day, EMPTY_ANSWER);
    case "disconnectClock":
      return legClock(row.disconnectTime, setup.day, "");
    case "redirectNumber": {
      const outgoing = row.outgoingRedirectingNumber.trim();
      if (outgoing) return outgoing;
      return row.incomingRedirectingNumber.trim();
    }
    case "billableMinutes":
      return smgBillableMinutesCell(row.duration);
  }
}

export function smgSummaryCellText(
  column: string,
  row: ClockSource & Record<SmgField, string>,
): string {
  if (column === "antifraud") return row.antifraud ?? AF_CATEGORY.noData;
  if (column === "antifraudStatus") return row.antifraudStatus ?? AF_STATUS.unknown;
  if ((SMG_RADIUS_DELAY_COLUMNS as readonly string[]).includes(column)) {
    return row[column as SmgRadiusDelayColumn] ?? "";
  }
  if (isSmgAntifraudColumn(column)) return "";
  if (isSmgSummaryDerived(column)) return formatSmgSummaryCell(column, row);
  if (isSmgField(column)) return row[column];
  return "";
}

export function formatSmgPoisonSummary(
  files: readonly { filename: string; error: string }[],
): string | null {
  if (files.length === 0) return null;
  const first = files[0]!;
  const detail = `${first.filename}: ${first.error}`;
  const where =
    files.length === 1
      ? "1 файл отложен"
      : `${formatCount(files.length)} файлов отложены`;
  return `В папке SMG ${where} (${detail}). Подробности на странице «Звонки на SMG».`;
}
