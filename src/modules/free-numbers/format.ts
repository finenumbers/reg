/**
 * Display mapping for DID free-number rows and facet menus.
 * Filter tokens stay as DID sends them. Cells show the same price text.
 */

import {
  facetQueryMatchesEmptyLabel,
  type FacetItem,
  type FacetResponse,
} from "@/components/column-filters/types";
import { PRICE_COLUMNS, type FreeNumberColumn } from "@/modules/free-numbers/columns";
import { escapeIlike } from "@/modules/did/types";

const PROVIDER_LABELS: Record<string, string> = {
  sipout: "SipOut",
  runexis: "Runexis",
  uis: "UIS",
  aurora: "Aurora Telecom",
  finenumbers: "Finenumbers",
  exolve: "Exolve",
  voximplant: "Voximplant",
  mcn: "MCN Telecom",
  didww: "DIDWW",
  twilio: "Twilio",
};

export function displayProviderCode(code: string): string {
  return PROVIDER_LABELS[code] ?? code;
}

/** Python Decimal ROUND_HALF_UP, then space-grouped digits. Matches DID facets. */
export function formatDidPrice(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const raw =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(raw)) return "";
  const sign = raw < 0 ? -1 : 1;
  const rounded = sign * Math.round(Math.abs(raw));
  return groupDigits(rounded);
}

function groupDigits(value: number): string {
  const sign = value < 0 ? "-" : "";
  let digits = String(Math.abs(value));
  const parts: string[] = [];
  while (digits.length > 3) {
    parts.unshift(digits.slice(-3));
    digits = digits.slice(0, -3);
  }
  parts.unshift(digits);
  return sign + parts.join(" ");
}

/**
 * DID compares facet `q` with the rounded number before it inserts spaces
 * (`1500`, not `1 500`). Both typed forms become that compact integer.
 */
export function priceFacetQuery(query: string): string {
  const compact = query.trim().replace(/\s/g, "");
  if (!/^-?\d+$/.test(compact)) return query.trim();
  const value = Number(compact);
  if (!Number.isSafeInteger(value)) return query.trim();
  return compact;
}

export function facetSearchQuery(column: string, query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (column === "provider_code") return null;
  const raw = PRICE_COLUMNS.has(column as FreeNumberColumn)
    ? priceFacetQuery(trimmed)
    : trimmed;
  return escapeIlike(raw);
}

export function displayFreeNumberFacet(column: string, value: string): string {
  if (value === "" || value === "__empty__") return "(пусто)";
  if (column === "provider_code") return displayProviderCode(value);
  if (column === "mask_purchase" || column === "premium") {
    return formatDidPrice(value) || value;
  }
  return value;
}

export function shapeFreeNumberFacets(input: {
  column: string;
  q: string;
  items: FacetItem[];
  truncated: boolean;
  emptyCount: number | null;
  limit: number;
}): FacetResponse {
  let items = input.items;
  if (input.column === "provider_code") {
    const needle = input.q.trim().toLowerCase();
    if (needle) {
      items = items.filter((item) =>
        displayFreeNumberFacet(input.column, item.value).toLowerCase().includes(needle),
      );
    }
  }
  if (
    facetQueryMatchesEmptyLabel(input.q) &&
    input.emptyCount != null &&
    input.emptyCount > 0 &&
    !items.some((item) => item.value === "" || item.value === "__empty__")
  ) {
    items = [{ value: "", count: input.emptyCount }, ...items];
  }
  const truncated = input.truncated || items.length > input.limit;
  return {
    items: items.slice(0, input.limit),
    truncated,
  };
}

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export type ListFreeNumbersResult = {
  items: FreeNumberRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type FreeNumberRow = {
  id: string;
  provider_code: string;
  abc_code: string;
  number_local: string;
  number_category: string;
  city_name: string;
  region_name: string;
  operator: string;
  buy_price: string;
  period_price: string;
  mask_purchase: string;
  type_label: string;
  premium: string;
};

const HIDDEN_KEYS = ["client", "rtu_connected", "msisdn", "provider_number_key"] as const;

export function mapFreeNumberRow(raw: unknown): FreeNumberRow | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = asText(record.id).trim();
  if (!id) return null;
  const row: FreeNumberRow = {
    id,
    provider_code: displayProviderCode(asText(record.provider_code)),
    abc_code: asText(record.abc_code),
    number_local: asText(record.number_local),
    number_category: asText(record.number_category),
    city_name: asText(record.city_name),
    region_name: asText(record.region_name),
    operator: asText(record.operator),
    buy_price: formatDidPrice(record.buy_price as string | number | null),
    period_price: formatDidPrice(record.period_price as string | number | null),
    mask_purchase: formatDidPrice(record.mask_purchase as string | number | null),
    type_label: asText(record.type_label),
    premium: formatDidPrice(record.premium as string | number | null),
  };
  for (const key of HIDDEN_KEYS) {
    if (key in row) delete (row as Record<string, unknown>)[key];
  }
  return row;
}
