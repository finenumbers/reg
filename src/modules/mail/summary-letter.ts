/**
 * The numbering summary letter. Pure: no database and no SMTP.
 */

import { geographyAbcText } from "@/modules/rtu/abc-display";
import { collapseShownRegion, MOBILE_RF_DIRECTION } from "@/modules/rtu/columns";

export const SUMMARY_ERROR = "Ошибка загрузки";
export const MANUAL_SOURCE = "Вручную";
export const PROBLEM_MASK = "Нет маски и типа";
export const PROBLEM_PSTN = "Нет оператора связи";
export const PROBLEM_RTU = "Номера нет в РТУ";
export const PROBLEM_LIMIT = 100;

const WEEKDAY_ACCUSATIVE: Record<string, string> = {
  понедельник: "понедельник",
  вторник: "вторник",
  среда: "среду",
  четверг: "четверг",
  пятница: "пятницу",
  суббота: "субботу",
  воскресенье: "воскресенье",
};

export type SummarySide = "free" | "purchased";

export type SummaryRow = {
  provider: string;
  count: number | null;
  previous: number | null;
  at: number | null;
  error: boolean;
  dateOnly: boolean;
};

export type ProblemRow = {
  provider: string;
  side: SummarySide;
  /** Whole number the screen uses to place the leading 7. */
  full: string;
  abc: string;
  number: string;
  city: string;
  region: string;
  problem: "mask" | "pstn" | "rtu";
};

export type SummaryLetterInput = {
  asOf: string;
  previousAsOf: string | null;
  timeZone: string;
  freeTotal: number;
  freeErrors: number;
  purchasedTotal: number;
  purchasedErrors: number;
  freeRows: SummaryRow[];
  purchasedRows: SummaryRow[];
  problems: ProblemRow[];
  problemTotal: number;
};

type Zoned = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
};

function zoned(date: Date, timeZone: string): Zoned {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = new Intl.DateTimeFormat("ru-RU", { timeZone, weekday: "long" }).format(
    date,
  );
  return {
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    hour: Number(pick("hour")),
    minute: Number(pick("minute")),
    weekday,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function stamp(parts: Zoned): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function shiftBack(parts: Zoned): string {
  const noon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  noon.setUTCDate(noon.getUTCDate() - 1);
  return stamp(zoned(noon, "UTC"));
}

/** Calendar day of the 17:00 UTC slot. Local midnight belongs to the previous day. */
export function scheduledAsOf(startedAt: Date, timeZone: string): string {
  const slot = new Date(
    Date.UTC(
      startedAt.getUTCFullYear(),
      startedAt.getUTCMonth(),
      startedAt.getUTCDate(),
      17,
    ),
  );
  if (startedAt.getTime() < slot.getTime()) slot.setUTCDate(slot.getUTCDate() - 1);
  const parts = zoned(slot, timeZone);
  return parts.hour === 0 ? shiftBack(parts) : stamp(parts);
}

export function localAsOf(startedAt: Date, timeZone: string): string {
  return stamp(zoned(startedAt, timeZone));
}

export function formatAsOf(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

export function weekdayAccusative(iso: string): string {
  const noon = new Date(`${iso}T12:00:00.000Z`);
  const name = zoned(noon, "UTC").weekday.toLowerCase();
  return WEEKDAY_ACCUSATIVE[name] ?? name;
}

export function formatLoadStamp(
  at: number | null,
  timeZone: string,
  dateOnly: boolean,
): string {
  if (at == null) return "—";
  const parts = zoned(new Date(at), timeZone);
  const day = `${pad(parts.day)}.${pad(parts.month)}.${parts.year}`;
  if (dateOnly) return day;
  return `${pad(parts.hour)}:${pad(parts.minute)}, ${day}`;
}

export function groupDigits(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value).replace(/[\u00a0\u202f]/g, " ");
}

export function formatDelta(today: number, previous: number | null): string {
  if (previous == null) return "—";
  const diff = today - previous;
  if (diff > 0) return `+${groupDigits(diff)}`;
  if (diff < 0) return `-${groupDigits(-diff)}`;
  return "0";
}

/** Same «ABC» text as the number tables. */
export function shownAbc(row: Pick<ProblemRow, "full" | "abc" | "number">): string {
  return geographyAbcText(row.full, row.abc, row.number);
}

export function shownProblemRegion(city: string, region: string): string {
  if (city.trim() === MOBILE_RF_DIRECTION) return collapseShownRegion(region);
  return collapseShownRegion(region);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function problemLabel(problem: ProblemRow["problem"]): string {
  if (problem === "mask") return PROBLEM_MASK;
  if (problem === "pstn") return PROBLEM_PSTN;
  return PROBLEM_RTU;
}

function sideLabel(side: SummarySide): string {
  return side === "free" ? "Свободные" : "Купленные";
}

function countCell(row: SummaryRow): string {
  if (row.error) return SUMMARY_ERROR;
  if (row.count == null) return "—";
  return groupDigits(row.count);
}

function deltaCell(row: SummaryRow): string {
  if (row.error) return "";
  if (row.count == null) return "—";
  return formatDelta(row.count, row.previous);
}

function previousCell(row: SummaryRow): string {
  if (row.previous == null) return "—";
  return groupDigits(row.previous);
}

export function summarySubject(asOf: string): string {
  return `Последняя загрузка телефонной нумерации (по состоянию на ${weekdayAccusative(asOf)}, на ${formatAsOf(asOf)})`;
}

function textTable(
  rows: SummaryRow[],
  timeZone: string,
  today: string,
  previous: string,
): string {
  const header = [
    "Провайдер",
    `На ${today}`,
    previous ? `На ${previous}` : "—",
    "Изменение",
    "Время загрузки",
  ];
  const lines = [header.join("\t")];
  for (const row of rows) {
    lines.push(
      [
        row.provider,
        countCell(row),
        previousCell(row),
        deltaCell(row),
        formatLoadStamp(row.at, timeZone, row.dateOnly),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

function htmlTable(
  rows: SummaryRow[],
  timeZone: string,
  today: string,
  previous: string,
): string {
  const head = [
    "Провайдер",
    `На ${today}`,
    previous ? `На ${previous}` : "—",
    "Изменение",
    "Время загрузки",
  ]
    .map((cell) => `<th>${escapeHtml(cell)}</th>`)
    .join("");
  const body = rows
    .map((row) => {
      const cells = [
        row.provider,
        countCell(row),
        previousCell(row),
        deltaCell(row),
        formatLoadStamp(row.at, timeZone, row.dateOnly),
      ];
      return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderSummary(input: SummaryLetterInput): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = summarySubject(input.asOf);
  const today = formatAsOf(input.asOf);
  const previous = input.previousAsOf ? formatAsOf(input.previousAsOf) : "";
  const shown = input.problems.slice(0, PROBLEM_LIMIT);
  const more =
    input.problemTotal > shown.length
      ? `Показаны первые ${shown.length} из ${groupDigits(input.problemTotal)}.`
      : "";
  const text = [
    subject,
    "",
    `Реестр «Свободные номера» с подтверждением: ${groupDigits(input.freeTotal)} номеров (${groupDigits(input.freeErrors)} с ошибками)`,
    "",
    textTable(input.freeRows, input.timeZone, today, previous),
    "",
    `Реестр «Купленные номера» с подтверждением: ${groupDigits(input.purchasedTotal)} номеров (${groupDigits(input.purchasedErrors)} с ошибками)`,
    "",
    textTable(input.purchasedRows, input.timeZone, today, previous),
    "",
    `Проблемные номера: ${groupDigits(input.problemTotal)} номеров`,
    more,
    ["Провайдер", "Категория", "ABC", "Номер", "Город", "Регион", "Проблема"].join("\t"),
    ...shown.map((row) =>
      [
        row.provider,
        sideLabel(row.side),
        shownAbc(row),
        row.number,
        row.city,
        shownProblemRegion(row.city, row.region),
        problemLabel(row.problem),
      ].join("\t"),
    ),
  ]
    .filter((line) => line !== "")
    .join("\n");
  const problemRows = shown
    .map((row) => {
      const cells = [
        row.provider,
        sideLabel(row.side),
        shownAbc(row),
        row.number,
        row.city,
        shownProblemRegion(row.city, row.region),
        problemLabel(row.problem),
      ];
      return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`;
    })
    .join("");
  const html = [
    `<p>${escapeHtml(subject)}</p>`,
    `<p>Реестр «Свободные номера» с подтверждением: ${escapeHtml(groupDigits(input.freeTotal))} номеров (${escapeHtml(groupDigits(input.freeErrors))} с ошибками)</p>`,
    htmlTable(input.freeRows, input.timeZone, today, previous),
    `<p>Реестр «Купленные номера» с подтверждением: ${escapeHtml(groupDigits(input.purchasedTotal))} номеров (${escapeHtml(groupDigits(input.purchasedErrors))} с ошибками)</p>`,
    htmlTable(input.purchasedRows, input.timeZone, today, previous),
    `<p>Проблемные номера: ${escapeHtml(groupDigits(input.problemTotal))} номеров</p>`,
    more ? `<p>${escapeHtml(more)}</p>` : "",
    `<table><thead><tr><th>Провайдер</th><th>Категория</th><th>ABC</th><th>Номер</th><th>Город</th><th>Регион</th><th>Проблема</th></tr></thead><tbody>${problemRows}</tbody></table>`,
  ].join("");
  return { subject, text, html };
}
