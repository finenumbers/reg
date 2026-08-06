"use client";

import type { ColumnFilters } from "@/components/column-filters/types";
import { displayFacetValue } from "@/components/column-filters/types";

type Props = {
  filters: ColumnFilters;
  /** column key → human header label */
  headers: Record<string, string>;
  /** optional value formatter per column */
  formatValue?: (field: string, value: string) => string;
  onRemoveFacet: (field: string, value: string) => void;
};

export function ActiveFiltersBar({
  filters,
  headers,
  formatValue,
  onRemoveFacet,
}: Props) {
  const chips: { key: string; label: string; onRemove: () => void }[] = [];

  for (const [field, values] of Object.entries(filters)) {
    const header = headers[field] ?? field;
    for (const value of values) {
      const shown = formatValue
        ? formatValue(field, value)
        : displayFacetValue(value);
      chips.push({
        key: `${field}:${value}`,
        label: `${header}: ${shown}`,
        onRemove: () => onRemoveFacet(field, value),
      });
    }
  }

  if (chips.length === 0) return null;

  return (
    <div className="active-filters">
      <span className="active-filters-label">Активные фильтры:</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="active-filter-chip"
          onClick={chip.onRemove}
        >
          {chip.label}
          <span aria-hidden>×</span>
        </button>
      ))}
    </div>
  );
}
