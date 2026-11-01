/**
 * Display mapping for DID purchased rows. Filter tokens stay as DID sends them.
 * «Нет в РТУ» is a real client value, not an empty cell.
 */

import {
  displayProviderCode,
  facetSearchQuery,
  formatDidPrice,
  shapeFreeNumberFacets,
} from "@/modules/free-numbers/format";

export { facetSearchQuery, shapeFreeNumberFacets as shapePurchasedNumberFacets };

export type PurchasedNumberRow = {
  id: string;
  provider_code: string;
  abc_code: string;
  number_local: string;
  number_category: string;
  city_name: string;
  region_name: string;
  client: string;
  operator: string;
  buy_price: string;
  period_price: string;
  mask_purchase: string;
  type_label: string;
  premium: string;
  rtu_connected: string;
};

export type ListPurchasedNumbersResult = {
  items: PurchasedNumberRow[];
  total: number;
  page: number;
  pageSize: number;
};

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function price(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || value == null) {
    return formatDidPrice(value);
  }
  return "";
}

export function mapPurchasedNumberRow(raw: unknown): PurchasedNumberRow | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = asText(record.id).trim();
  if (!id) return null;
  return {
    id,
    provider_code: displayProviderCode(asText(record.provider_code)),
    abc_code: asText(record.abc_code),
    number_local: asText(record.number_local),
    number_category: asText(record.number_category),
    city_name: asText(record.city_name),
    region_name: asText(record.region_name),
    client: asText(record.client),
    operator: asText(record.operator),
    buy_price: price(record.buy_price),
    period_price: price(record.period_price),
    mask_purchase: price(record.mask_purchase),
    type_label: asText(record.type_label),
    premium: price(record.premium),
    rtu_connected: asText(record.rtu_connected),
  };
}
