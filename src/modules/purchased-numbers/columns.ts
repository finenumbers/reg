/**
 * Columns of «Купленные номера». Identifiers are purchased_numbers fields.
 * Headers are the Russian labels, in screen order.
 */

export const PURCHASED_NUMBER_COLUMNS = [
  "provider",
  "abc",
  "number",
  "city",
  "region",
  "client",
  "purchase",
  "subscription",
  "mask",
  "maskType",
  "sale",
  "premium",
  "operator",
  "geography",
] as const;

export type PurchasedNumberColumn = (typeof PURCHASED_NUMBER_COLUMNS)[number];

export const PURCHASED_NUMBER_HEADERS: Record<PurchasedNumberColumn, string> = {
  provider: "Провайдер",
  abc: "ABC",
  number: "Номер",
  city: "Город",
  region: "Регион",
  client: "Клиент",
  purchase: "Покупка",
  subscription: "Абонплата",
  mask: "Маска",
  maskType: "Тип",
  sale: "Продажа",
  premium: "Премиум",
  operator: "Оператор связи",
  geography: "География",
};

const COLUMN_SET = new Set<string>(PURCHASED_NUMBER_COLUMNS);

/** Stored as text. The screen groups a whole number and keeps a fraction. */
export const AMOUNT_COLUMNS = new Set<PurchasedNumberColumn>([
  "purchase",
  "subscription",
  "sale",
  "premium",
]);

export function isPurchasedNumberColumn(value: string): value is PurchasedNumberColumn {
  return COLUMN_SET.has(value);
}

export function isAmountColumn(value: string): value is PurchasedNumberColumn {
  return AMOUNT_COLUMNS.has(value as PurchasedNumberColumn);
}
