/**
 * Working SMG table. Same stored CDR row as the full dump.
 * Дата / Время are the call start. The month and the list order stay on disconnect.
 */

import { formatCount } from "@/lib/format-count";
import { billableMinutes } from "@/modules/enrich/types";
import { isSmgField, SMG_PHONE_FIELDS, type SmgField } from "@/modules/smg/columns";
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
  "incomingType",
  "incomingDescription",
  "outgoingType",
  "outgoingDescription",
  "releaseCause",
  "callReleaseInfo",
  "releaseSideMark",
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
  incomingType: "Тип входа",
  incomingDescription: "Вход",
  outgoingType: "Тип выхода",
  outgoingDescription: "Выход",
  releaseCause: "Q.850",
  callReleaseInfo: "Статус",
  releaseSideMark: "Сброс",
};

/**
 * Facet menus on the working table. Seconds and the derived columns stay out:
 * a duration or a timestamp groups the whole gateway-month, and the indexed
 * day is the disconnect day, not the start date shown as «Дата».
 */
export const SMG_SUMMARY_FACET_COLUMNS = [
  "incomingCgpn",
  "outgoingCgpn",
  "incomingCdpn",
  "outgoingCdpn",
  "incomingType",
  "incomingDescription",
  "outgoingType",
  "outgoingDescription",
  "releaseCause",
  "callReleaseInfo",
  "releaseSideMark",
] as const satisfies readonly SmgField[];

const DERIVED_SET = new Set<string>(SMG_SUMMARY_DERIVED);
const PHONE_SET = new Set<string>(SMG_PHONE_FIELDS);

export function isSmgSummaryDerived(column: string): column is SmgSummaryDerived {
  return DERIVED_SET.has(column);
}

export function isSmgSummaryPhoneColumn(column: string): boolean {
  return PHONE_SET.has(column);
}

type ClockSource = {
  setupTime: string;
  connectTime: string;
  disconnectTime: string;
  duration: string;
  incomingRedirectingNumber: string;
  outgoingRedirectingNumber: string;
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
