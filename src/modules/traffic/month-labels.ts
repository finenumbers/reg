import { formatCount } from "@/lib/format-count";

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

export function formatMonthOption(
  year: number,
  month: number,
  count?: number,
): string {
  const name = formatMonthNominative(year, month);
  if (count == null) return name;
  return `${name} (${formatCount(count)})`;
}

export function formatMonthGenitive(year: number, month: number): string {
  return `${GENITIVE[monthIndex(month)]} ${year} года`;
}

export function monthExportJobTitle(
  year: number,
  month: number,
  includeDetail = false,
): string {
  const verb = includeDetail
    ? "Сохранить расширенные данные"
    : "Сохранить данные";
  return `${verb} ${formatMonthGenitive(year, month)}`;
}

export function monthExportSheetName(year: number, month: number): string {
  return formatMonthNominative(year, month);
}
