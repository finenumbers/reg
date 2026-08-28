import type { MonthPeriod } from "@/lib/month-window";

const NOMINATIVE = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const;

const GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

function monthIndex(month: number): number {
  if (month < 1 || month > 12) {
    throw new Error(`Некорректный месяц: ${month}`);
  }
  return month - 1;
}

export function formatMonthNominative(year: number, month: number): string {
  return `${NOMINATIVE[monthIndex(month)]} ${year} года`;
}

export function formatMonthGenitive(year: number, month: number): string {
  return `${GENITIVE[monthIndex(month)]} ${year} года`;
}

export function monthExportButtonLabel(
  period: MonthPeriod,
  year: number,
  month: number,
): string {
  const genitive = formatMonthGenitive(year, month);
  return period === "previous"
    ? `Сохранить данные ${genitive}`
    : `Неполные данные ${genitive}`;
}

export function monthExportSheetName(
  period: MonthPeriod,
  year: number,
  month: number,
): string {
  const nominative = formatMonthNominative(year, month);
  return period === "previous" ? nominative : `${nominative} (неполный)`;
}
