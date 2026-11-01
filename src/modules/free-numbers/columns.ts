/**
 * Columns shown on «Свободные номера». Same set as the DID free-numbers page.
 * Identifiers are DID catalog keys. Headers are the Russian labels.
 */

export const FREE_NUMBER_COLUMNS = [
  "provider_code",
  "abc_code",
  "number_local",
  "number_category",
  "city_name",
  "region_name",
  "operator",
  "buy_price",
  "period_price",
  "mask_purchase",
  "type_label",
  "premium",
] as const;

export type FreeNumberColumn = (typeof FREE_NUMBER_COLUMNS)[number];

export const FREE_NUMBER_HEADERS: Record<FreeNumberColumn, string> = {
  provider_code: "Провайдер",
  abc_code: "ABC",
  number_local: "Номер",
  number_category: "Категория",
  city_name: "Город",
  region_name: "Регион",
  operator: "Оператор",
  buy_price: "Покупка (Входящая)",
  period_price: "Абонплата (Входящая)",
  mask_purchase: "Покупка",
  type_label: "Тип",
  premium: "Премиум",
};

const COLUMN_SET = new Set<string>(FREE_NUMBER_COLUMNS);

export const PRICE_COLUMNS = new Set<FreeNumberColumn>([
  "buy_price",
  "period_price",
  "mask_purchase",
  "premium",
]);

export function isFreeNumberColumn(value: string): value is FreeNumberColumn {
  return COLUMN_SET.has(value);
}
