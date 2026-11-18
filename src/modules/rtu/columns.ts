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
  "sale",
  "premium",
  "operator",
  "geography",
  "title",
  "activation",
] as const;

export type RtuColumn = (typeof RTU_COLUMNS)[number];

/** Hidden together when the «Маски и типы» switch is off. The data contract keeps them. */
const RTU_MASK_COLUMN_LIST = ["mask", "maskType", "sale", "premium"] as const;

const RTU_MASK_COLUMNS: ReadonlySet<RtuColumn> = new Set(RTU_MASK_COLUMN_LIST);

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
  sale: "Продажа",
  premium: "Премиум",
  operator: "Оператор связи",
  geography: "География",
  title: "Название",
  activation: "Статус",
};

/** Tariff directions that stay a normal row. A «г. …» city is the third kind. */
export const MOBILE_RF_DIRECTION = "Мобильные РФ";
export const FREE_CALL_DIRECTION = "Бесплатный вызов";

/**
 * Shown «Регион» only. Geography and the stored tariff region stay.
 * Compared after ASCII-space trim, the same characters as PostgreSQL btrim.
 */
export const SHOWN_REGION_REPLACEMENTS = [
  ["Московская область, Город Москва", "Московская область"],
  ["Город Москва, Московская область", "Московская область"],
  ["Ленинградская область, Город Санкт-Петербург", "Ленинградская область"],
  ["Город Санкт-Петербург, Ленинградская область", "Ленинградская область"],
] as const;

/** Bound pairs, source then replacement, in CASE order. */
export function shownRegionBindingValues(): string[] {
  return SHOWN_REGION_REPLACEMENTS.flatMap(([from, to]) => [from, to]);
}

/** PostgreSQL btrim with no second argument. Only U+0020. */
function trimAsciiSpace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 32) start += 1;
  while (end > start && value.charCodeAt(end - 1) === 32) end -= 1;
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

/** Short oblast for the four compound labels. Any other text is returned unchanged. */
export function collapseShownRegion(value: string): string {
  const trimmed = trimAsciiSpace(value);
  for (const [from, to] of SHOWN_REGION_REPLACEMENTS) {
    if (trimmed === from) return to;
  }
  return value;
}

const COLUMN_SET = new Set<string>(RTU_COLUMNS);

export function isRtuColumn(value: string): value is RtuColumn {
  return COLUMN_SET.has(value);
}

/**
 * Operator, geography, and the displayed region are read with the PSTN cache.
 * A city of «Мобильные РФ» shows that geography in the region cell.
 * The shown cell then collapses the four Moscow and Petersburg labels.
 * City, the tariff region, ABC, the local number, and the four mask cells
 * are stored on the screen snapshot.
 */
export const EXPENSIVE_COLUMNS = new Set<RtuColumn>(["operator", "geography", "region"]);

/** Digit columns split from the tariff row. ABC stays left, the local number stays right. */
export function geographyDigitAlign(column: RtuColumn): "left" | "right" | null {
  if (column === "abc") return "left";
  if (column === "telephone") return "right";
  return null;
}

/** Cell alignment. Sale and premium sit on the right with the local number. */
export function rtuCellAlign(column: RtuColumn): "left" | "right" | null {
  if (column === "sale" || column === "premium") return "right";
  return geographyDigitAlign(column);
}
