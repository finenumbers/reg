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
  "mask",
  "maskType",
  "purchase",
  "premium",
  "operator",
  "geography",
  "title",
  "activation",
] as const;

export type RtuColumn = (typeof RTU_COLUMNS)[number];

/** Hidden together when the «Маски и типы» switch is off. The data contract keeps them. */
const RTU_MASK_COLUMN_LIST = ["mask", "maskType", "purchase", "premium"] as const;

export const RTU_MASK_COLUMNS: ReadonlySet<RtuColumn> = new Set(RTU_MASK_COLUMN_LIST);

/** Hidden together when the «Маски и типы» switch is on. The data contract keeps them. */
const RTU_MASK_ON_HIDDEN_LIST = ["category", "supplier", "source"] as const;

const RTU_MASK_ON_HIDDEN: ReadonlySet<RtuColumn> = new Set(RTU_MASK_ON_HIDDEN_LIST);

export const RTU_COLUMNS_WITHOUT_MASKS: readonly RtuColumn[] = RTU_COLUMNS.filter(
  (column) => !RTU_MASK_COLUMNS.has(column),
);

/** Screen columns while «Маски и типы» is on. Not the data contract. */
export const RTU_COLUMNS_WITH_MASKS: readonly RtuColumn[] = RTU_COLUMNS.filter(
  (column) => !RTU_MASK_ON_HIDDEN.has(column),
);

export function isRtuMaskColumn(column: string): boolean {
  return (RTU_MASK_COLUMNS as ReadonlySet<string>).has(column);
}

function isRtuMaskOnHiddenColumn(column: string): boolean {
  return (RTU_MASK_ON_HIDDEN as ReadonlySet<string>).has(column);
}

/**
 * A header menu closes when this switch position removes its column.
 * Shared columns, including «Город», stay open.
 */
export function rtuFilterColumnStaysOpen(column: string, showMaskColumns: boolean): boolean {
  if (showMaskColumns) return !isRtuMaskOnHiddenColumn(column);
  return !isRtuMaskColumn(column);
}

/** Screen columns. The full contract is `RTU_COLUMNS`. Both results are stable arrays. */
export function visibleRtuColumns(showMaskColumns: boolean): readonly RtuColumn[] {
  return showMaskColumns ? RTU_COLUMNS_WITH_MASKS : RTU_COLUMNS_WITHOUT_MASKS;
}

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
  mask: "Маска",
  maskType: "Тип",
  purchase: "Покупка",
  premium: "Премиум",
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

/**
 * Operator and geography are read from the PSTN cache at request time.
 * City, region, ABC, the local number, and the four mask cells are stored
 * on the screen snapshot.
 */
export const EXPENSIVE_COLUMNS = new Set<RtuColumn>(["operator", "geography"]);

/** Digit columns split from the tariff row. ABC stays left, the local number stays right. */
export function geographyDigitAlign(column: RtuColumn): "left" | "right" | null {
  if (column === "abc") return "left";
  if (column === "telephone") return "right";
  return null;
}

/** Cell alignment. Purchase and premium sit on the right with the local number. */
export function rtuCellAlign(column: RtuColumn): "left" | "right" | null {
  if (column === "purchase" || column === "premium") return "right";
  return geographyDigitAlign(column);
}
