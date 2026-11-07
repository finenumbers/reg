/**
 * Fixed columns of «Управление РТУ».
 * Identifiers stay in the API. Headers are the Russian labels.
 */

export const RTU_COLUMNS = [
  "category",
  "supplier",
  "source",
  "city",
  "region",
  "abc",
  "telephone",
  "client",
  "capacity",
  "operator",
  "geography",
  "title",
  "activation",
] as const;

export type RtuColumn = (typeof RTU_COLUMNS)[number];

export const RTU_HEADERS: Record<RtuColumn, string> = {
  category: "Категория",
  city: "Город",
  region: "Регион",
  abc: "ABC",
  telephone: "Номер",
  supplier: "Поставщик",
  source: "Источник",
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

const COLUMN_SET = new Set<string>(RTU_COLUMNS);

export function isRtuColumn(value: string): value is RtuColumn {
  return COLUMN_SET.has(value);
}

/** City, region, ABC, the local number, operator, and geography need the tariff function or the PSTN join. */
export const EXPENSIVE_COLUMNS = new Set<RtuColumn>([
  "city",
  "region",
  "abc",
  "telephone",
  "operator",
  "geography",
]);

/** Digit columns split from the tariff row. ABC stays left, the local number stays right. */
export function geographyDigitAlign(column: RtuColumn): "left" | "right" | null {
  if (column === "abc") return "left";
  if (column === "telephone") return "right";
  return null;
}
