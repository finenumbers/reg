/**
 * UIS Data API reads. The method name is chosen here, never from a caller.
 * POST is the JSON-RPC transport. One object, two get methods.
 */

export const UIS_ORIGIN = "https://dataapi.uiscom.ru/v2.0";

export const PAGE_LIMIT = 10_000;
export const OFFSET_MAX = 100_000;
export const WINDOW = OFFSET_MAX + PAGE_LIMIT;
export const ACCESS_LIMIT = 1_000;
export const COUNT_LIMIT = 1;
export const MAX_PREFIX = 15;

export type UisList = "purchased" | "free";

export type UisFilter =
  | { kind: "all" }
  | { kind: "like"; prefix: string }
  | { kind: "eq"; prefix: string }
  | { kind: "regexp"; prefix: string };

export type UisCall =
  | { purpose: "count"; filter: UisFilter }
  | { purpose: "read"; filter: UisFilter; offset: number }
  | { purpose: "access" }
  | { purpose: "probe" };

const PURCHASED_METHOD = "get.virtual_numbers";
const FREE_METHOD = "get.available_virtual_numbers";
const PURCHASED_FIELDS = ["virtual_phone_number"] as const;
const FREE_FIELDS = ["phone_number", "onetime_payment", "monthly_charge"] as const;

export function phoneField(list: UisList): "virtual_phone_number" | "phone_number" {
  return list === "purchased" ? "virtual_phone_number" : "phone_number";
}

function digits(prefix: string): boolean {
  return prefix.length > 0 && prefix.length <= MAX_PREFIX && /^\d+$/.test(prefix);
}

/** Null when this filter cannot be split any further. */
export function childFilters(parent: UisFilter): UisFilter[] | null {
  if (parent.kind === "all") {
    const likes = Array.from({ length: 10 }, (_, index) => ({
      kind: "like" as const,
      prefix: String(index),
    }));
    return [...likes, { kind: "regexp", prefix: "" }];
  }
  if (parent.kind === "like") {
    if (!digits(parent.prefix) || parent.prefix.length >= MAX_PREFIX) return null;
    const likes = Array.from({ length: 10 }, (_, index) => ({
      kind: "like" as const,
      prefix: `${parent.prefix}${index}`,
    }));
    return [
      { kind: "eq", prefix: parent.prefix },
      ...likes,
      { kind: "regexp", prefix: parent.prefix },
    ];
  }
  return null;
}

export function describeFilter(filter: UisFilter): string {
  if (filter.kind === "all") return "весь список";
  if (filter.kind === "like") return `префикс ${filter.prefix}`;
  if (filter.kind === "eq") return `равно ${filter.prefix}`;
  return filter.prefix ? `после ${filter.prefix} не цифра` : "не цифра";
}

function filterValue(
  filter: UisFilter,
): { operator: "like" | "=" | "regexp"; value: string } | null {
  if (filter.kind === "all") return null;
  if (filter.kind === "like") {
    if (!digits(filter.prefix)) return null;
    return { operator: "like", value: `${filter.prefix}%` };
  }
  if (filter.kind === "eq") {
    if (!digits(filter.prefix)) return null;
    return { operator: "=", value: filter.prefix };
  }
  if (filter.prefix === "") return { operator: "regexp", value: "^[^0-9]" };
  if (!digits(filter.prefix)) return null;
  return { operator: "regexp", value: `^${filter.prefix}[^0-9]` };
}

function callShape(
  list: UisList,
  call: UisCall,
): { offset: number; limit: number; filter: UisFilter; sort: boolean } | null {
  if (call.purpose === "access") {
    return {
      offset: 0,
      limit: ACCESS_LIMIT,
      filter: { kind: "all" },
      sort: list === "free",
    };
  }
  if (call.purpose === "probe") {
    return {
      offset: 0,
      limit: COUNT_LIMIT,
      filter: { kind: "like", prefix: "0" },
      sort: false,
    };
  }
  if (call.purpose === "count") {
    return { offset: 0, limit: COUNT_LIMIT, filter: call.filter, sort: false };
  }
  if (!Number.isSafeInteger(call.offset) || call.offset < 0 || call.offset > OFFSET_MAX) {
    return null;
  }
  if (call.offset % PAGE_LIMIT !== 0) return null;
  return {
    offset: call.offset,
    limit: PAGE_LIMIT,
    filter: call.filter,
    sort: list === "free",
  };
}

/** The JSON-RPC body. Null when the call is not one of the two reads. */
export function buildRequest(
  token: string,
  list: UisList,
  call: UisCall,
  id: number,
): string | null {
  if (!token || token !== token.trim()) return null;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (list !== "purchased" && list !== "free") return null;
  const shape = callShape(list, call);
  if (!shape) return null;
  const method = list === "purchased" ? PURCHASED_METHOD : FREE_METHOD;
  const params: Record<string, unknown> = {
    access_token: token,
    offset: shape.offset,
    limit: shape.limit,
    fields: list === "purchased" ? [...PURCHASED_FIELDS] : [...FREE_FIELDS],
  };
  if (shape.sort) {
    if (list !== "free") return null;
    params.sort = [{ field: "phone_number", order: "asc" }];
  }
  if (shape.filter.kind !== "all") {
    const value = filterValue(shape.filter);
    if (!value) return null;
    params.filter = {
      field: phoneField(list),
      operator: value.operator,
      value: value.value,
    };
  }
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

export function pageOffsets(total: number): number[] | null {
  if (!Number.isSafeInteger(total) || total < 0 || total > WINDOW) return null;
  const offsets: number[] = [];
  for (let offset = 0; offset < total; offset += PAGE_LIMIT) {
    if (offset > OFFSET_MAX) return null;
    offsets.push(offset);
  }
  return offsets;
}
