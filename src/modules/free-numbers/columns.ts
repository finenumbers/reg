/**
 * Columns of «Свободные номера». Identifiers are free_numbers fields.
 * Headers are the Russian labels, in screen order.
 */

export const FREE_NUMBER_COLUMNS = [
  "provider",
  "abc",
  "number",
  "category",
  "city",
  "region",
  "mask",
  "maskType",
  "incomingPurchase",
  "incomingPeriod",
  "purchase",
  "premium",
  "operator",
  "geography",
] as const;

export type FreeNumberColumn = (typeof FREE_NUMBER_COLUMNS)[number];

export const FREE_NUMBER_HEADERS: Record<FreeNumberColumn, string> = {
  provider: "Провайдер",
  abc: "ABC",
  number: "Номер",
  category: "Категория",
  city: "Город",
  region: "Регион",
  mask: "Маска",
  maskType: "Тип",
  incomingPurchase: "Покупка (входящая)",
  incomingPeriod: "Абонплата (входящая)",
  purchase: "Покупка",
  premium: "Премиум",
  operator: "Оператор связи",
  geography: "География",
};

const COLUMN_SET = new Set<string>(FREE_NUMBER_COLUMNS);

/** Stored as text. The screen groups a whole number and keeps a fraction. */
export const AMOUNT_COLUMNS = new Set<FreeNumberColumn>([
  "incomingPurchase",
  "incomingPeriod",
  "purchase",
  "premium",
]);

export function isFreeNumberColumn(value: string): value is FreeNumberColumn {
  return COLUMN_SET.has(value);
}

export function isAmountColumn(value: string): value is FreeNumberColumn {
  return AMOUNT_COLUMNS.has(value as FreeNumberColumn);
}
