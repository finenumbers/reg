/**
 * Current PSTN dataset columns. Diff columns are not part of this screen.
 */

export const NUMBERING_COLUMNS = [
  "abc",
  "rangeStart",
  "rangeEnd",
  "capacity",
  "operator",
  "garTerritory",
  "uvrAntifraud",
  "inn",
] as const;

export type NumberingColumn = (typeof NUMBERING_COLUMNS)[number];

export const NUMBERING_FACET_COLUMNS = [
  "abc",
  "operator",
  "garTerritory",
  "inn",
  "uvrAntifraud",
] as const;

export type NumberingFacetColumn = (typeof NUMBERING_FACET_COLUMNS)[number];

export const NUMBERING_HEADERS: Record<NumberingColumn, string> = {
  abc: "ABC",
  rangeStart: "Начало",
  rangeEnd: "Конец",
  capacity: "Емкость",
  operator: "Оператор связи",
  garTerritory: "Территория ГАР",
  uvrAntifraud: "УВр Антифрод",
  inn: "ИНН",
};

const FACET_SET = new Set<string>(NUMBERING_FACET_COLUMNS);

export function isNumberingFacetColumn(value: string): value is NumberingFacetColumn {
  return FACET_SET.has(value);
}

export function isBoldNumberingColumn(column: NumberingColumn): boolean {
  return column === "rangeStart" || column === "rangeEnd";
}
