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
  /** Parse / RTU / PSTN problems for this provider on this side. */
  errors: number;
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

/** 1 номер, 2 номера, 5 номеров, 11 номеров, 21 номер. */
export function numberNoun(value: number): string {
  const tail = Math.abs(value) % 100;
  const last = tail % 10;
  if (tail > 10 && tail < 15) return "номеров";
  if (last === 1) return "номер";
  if (last >= 2 && last <= 4) return "номера";
  return "номеров";
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

/** Number order: whole e164, then the local part. */
export function compareProblemRows(a: ProblemRow, b: ProblemRow): number {
  return a.full.localeCompare(b.full, "en") || a.number.localeCompare(b.number, "en");
}

export function problemsForSide(
  rows: readonly ProblemRow[],
  side: SummarySide,
): ProblemRow[] {
  return rows
    .filter((row) => row.side === side)
    .slice()
    .sort(compareProblemRows)
    .slice(0, PROBLEM_LIMIT);
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

function errorsCell(row: SummaryRow): string {
  return groupDigits(row.errors);
}

export function summarySubject(asOf: string): string {
  return `Последняя загрузка телефонной нумерации (по состоянию на ${weekdayAccusative(asOf)}, на ${formatAsOf(asOf)})`;
}

const GREEN = "#16a34a";
const BLUE = "#2563eb";
const RED = "#dc2626";
const VIOLET = "#7c3aed";
const FONT = "font-family:Arial,Helvetica,sans-serif";
const CELL = `border:1px solid #000;padding:4px 8px;${FONT};font-size:13px`;

function htmlCell(
  tag: "td" | "th",
  text: string,
  align: "left" | "center" | "right",
  paint?: { color?: string; bold?: boolean; bg?: string },
): string {
  const bg = paint?.bg ?? "#ffffff";
  const weight = paint?.bold || tag === "th" ? "font-weight:bold;" : "";
  const color = paint?.color ? `color:${paint.color};` : "";
  const style = `${CELL};text-align:${align};${weight}${color}background-color:${bg}`;
  return `<${tag} bgcolor="${bg}" align="${align}" style="${style}">${escapeHtml(text)}</${tag}>`;
}

function paintedCount(text: string, color: string): { color?: string; bold?: boolean } {
  if (text === "—" || text === "") return {};
  return { color, bold: true };
}

function paintedErrors(errors: number): { color?: string; bold?: boolean } {
  if (errors <= 0) return {};
  return { color: RED, bold: true };
}

function registryFigure(value: number, color: string): string {
  return `<span style="color:${color};font-weight:bold;text-decoration:underline">${escapeHtml(groupDigits(value))}</span>`;
}

function registryLine(text: string): string {
  return `<p style="${FONT};font-size:14px;font-weight:bold;margin:16px 0 8px">${text}</p>`;
}

function moreLine(shown: number, total: number): string {
  if (total <= shown) return "";
  return `Показаны первые ${shown} из ${groupDigits(total)}.`;
}

function htmlRegistry(
  rows: SummaryRow[],
  timeZone: string,
  today: string,
  previous: string,
  side: SummarySide,
): string {
  const headers = [
    "Провайдер",
    `На ${today}`,
    previous ? `На ${previous}` : "—",
    "Изменение",
    "Ошибки",
    "Время загрузки",
  ];
  const head = headers.map((cell) => htmlCell("th", cell, "center")).join("");
  const body = rows
    .map((row) => {
      const manual = row.provider === MANUAL_SOURCE;
      const tone = manual ? VIOLET : side === "free" ? GREEN : BLUE;
      const current = countCell(row);
      const prior = previousCell(row);
      const delta = deltaCell(row);
      const errors = errorsCell(row);
      const stamp = formatLoadStamp(row.at, timeZone, row.dateOnly);
      const currentPaint = row.error
        ? { color: "#ffffff", bold: true, bg: RED }
        : paintedCount(current, tone);
      const deltaPaint = manual
        ? paintedCount(delta, VIOLET)
        : paintedCount(delta, "#000000");
      const cells = [
        htmlCell("td", row.provider, "left"),
        htmlCell("td", current, "right", currentPaint),
        htmlCell("td", prior, "right", paintedCount(prior, tone)),
        htmlCell("td", delta, "right", deltaPaint),
        htmlCell("td", errors, "right", paintedErrors(row.errors)),
        htmlCell("td", stamp, "right"),
      ];
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${FONT};font-size:13px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function htmlProblems(rows: ProblemRow[]): string {
  const headers = ["Провайдер", "ABC", "Номер", "Город", "Регион", "Проблема"];
  const aligns = ["left", "left", "right", "left", "left", "left"] as const;
  const head = headers.map((cell) => htmlCell("th", cell, "center")).join("");
  const body = rows
    .map((row) => {
      const values = [
        row.provider,
        shownAbc(row),
        row.number,
        row.city,
        shownProblemRegion(row.city, row.region),
        problemLabel(row.problem),
      ];
      return `<tr>${values.map((value, index) => htmlCell("td", value, aligns[index] ?? "left")).join("")}</tr>`;
    })
    .join("");
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${FONT};font-size:13px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
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
    "Ошибки",
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
        errorsCell(row),
        formatLoadStamp(row.at, timeZone, row.dateOnly),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

function textProblems(rows: ProblemRow[]): string {
  const lines = [
    ["Провайдер", "ABC", "Номер", "Город", "Регион", "Проблема"].join("\t"),
  ];
  for (const row of rows) {
    lines.push(
      [
        row.provider,
        shownAbc(row),
        row.number,
        row.city,
        shownProblemRegion(row.city, row.region),
        problemLabel(row.problem),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

export function renderSummary(input: SummaryLetterInput): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = summarySubject(input.asOf);
  const today = formatAsOf(input.asOf);
  const previous = input.previousAsOf ? formatAsOf(input.previousAsOf) : "";
  const freeShown = problemsForSide(input.problems, "free");
  const purchasedShown = problemsForSide(input.problems, "purchased");
  const freeMore = moreLine(freeShown.length, input.freeErrors);
  const purchasedMore = moreLine(purchasedShown.length, input.purchasedErrors);
  const text = [
    subject,
    "",
    `Реестр «Свободные номера» с подтверждением: ${groupDigits(input.freeTotal)} ${numberNoun(input.freeTotal)} (${groupDigits(input.freeErrors)} с ошибками)`,
    "",
    textTable(input.freeRows, input.timeZone, today, previous),
    "",
    `Реестр «Купленные номера» с подтверждением: ${groupDigits(input.purchasedTotal)} ${numberNoun(input.purchasedTotal)} (${groupDigits(input.purchasedErrors)} с ошибками)`,
    "",
    textTable(input.purchasedRows, input.timeZone, today, previous),
    "",
    `Проблемные номера: ${groupDigits(input.problemTotal)} ${numberNoun(input.problemTotal)}`,
    "",
    sideLabel("free"),
    freeMore,
    textProblems(freeShown),
    "",
    sideLabel("purchased"),
    purchasedMore,
    textProblems(purchasedShown),
  ]
    .filter((line) => line !== "")
    .join("\n");
  const html = [
    `<p style="${FONT};font-size:18px;font-weight:bold;margin:0 0 16px">${escapeHtml(subject)}</p>`,
    registryLine(
      `Реестр «Свободные номера» с подтверждением: ${registryFigure(input.freeTotal, GREEN)} ${numberNoun(input.freeTotal)} (${registryFigure(input.freeErrors, RED)} с ошибками)`,
    ),
    htmlRegistry(input.freeRows, input.timeZone, today, previous, "free"),
    registryLine(
      `Реестр «Купленные номера» с подтверждением: ${registryFigure(input.purchasedTotal, BLUE)} ${numberNoun(input.purchasedTotal)} (${registryFigure(input.purchasedErrors, RED)} с ошибками)`,
    ),
    htmlRegistry(input.purchasedRows, input.timeZone, today, previous, "purchased"),
    registryLine(
      `Проблемные номера: ${registryFigure(input.problemTotal, VIOLET)} ${numberNoun(input.problemTotal)}`,
    ),
    registryLine(sideLabel("free")),
    freeMore
      ? `<p style="${FONT};font-size:14px;margin:0 0 8px">${escapeHtml(freeMore)}</p>`
      : "",
    htmlProblems(freeShown),
    registryLine(sideLabel("purchased")),
    purchasedMore
      ? `<p style="${FONT};font-size:14px;margin:0 0 8px">${escapeHtml(purchasedMore)}</p>`
      : "",
    htmlProblems(purchasedShown),
  ].join("");
  return { subject, text, html };
}
