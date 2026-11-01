/**
 * Columns shown on «Купленные номера». Same set and order as the DID purchased page.
 */

export const PURCHASED_NUMBER_COLUMNS = [
  "provider_code",
  "abc_code",
  "number_local",
  "number_category",
  "city_name",
  "region_name",
  "client",
  "operator",
  "buy_price",
  "period_price",
  "mask_purchase",
  "type_label",
  "premium",
  "rtu_connected",
] as const;

export type PurchasedNumberColumn = (typeof PURCHASED_NUMBER_COLUMNS)[number];

export const PURCHASED_NUMBER_HEADERS: Record<PurchasedNumberColumn, string> = {
  provider_code: "Провайдер",
  abc_code: "ABC",
  number_local: "Номер",
  number_category: "Категория",
  city_name: "Город",
  region_name: "Регион",
  client: "Клиент",
  operator: "Оператор",
  buy_price: "Покупка (Входящая)",
  period_price: "Абонплата (Входящая)",
  mask_purchase: "Покупка",
  type_label: "Тип",
  premium: "Премиум",
  rtu_connected: "Подключено в РТУ",
};

const COLUMN_SET = new Set<string>(PURCHASED_NUMBER_COLUMNS);

export function isPurchasedNumberColumn(value: string): value is PurchasedNumberColumn {
  return COLUMN_SET.has(value);
}
