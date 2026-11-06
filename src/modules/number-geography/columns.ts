/**
 * Fixed columns of «География номеров».
 * Identifiers stay in the API. Headers are the Russian labels.
 */

export const NUMBER_GEOGRAPHY_COLUMNS = [
  "category",
  "supplier",
  "city",
  "client",
  "capacity",
  "operator",
  "geography",
  "number",
  "title",
  "activation",
] as const;

export type NumberGeographyColumn = (typeof NUMBER_GEOGRAPHY_COLUMNS)[number];

export const NUMBER_GEOGRAPHY_HEADERS: Record<NumberGeographyColumn, string> = {
  category: "Категория",
  city: "Город",
  supplier: "Поставщик",
  number: "Телефонный номер",
  client: "Клиент",
  capacity: "Канальность",
  operator: "Оператор связи",
  geography: "География",
  title: "Название",
  activation: "Статус",
};

/** Tariff directions that stay a normal row. A «г. …» city is the third kind. */
export const MOBILE_RF_DIRECTION = "Мобильные РФ";
export const FREE_CALL_DIRECTION = "Бесплатный вызов";

const COLUMN_SET = new Set<string>(NUMBER_GEOGRAPHY_COLUMNS);

export function isNumberGeographyColumn(value: string): value is NumberGeographyColumn {
  return COLUMN_SET.has(value);
}

/** City, operator, and geography need the tariff function or the PSTN join. */
export const EXPENSIVE_COLUMNS = new Set<NumberGeographyColumn>([
  "city",
  "operator",
  "geography",
]);
