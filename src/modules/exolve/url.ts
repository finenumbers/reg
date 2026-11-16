/**
 * Three POST paths on the Exolve numbering API. The bodies are built here.
 * A caller cannot choose a path, a filter, or a mask.
 */

export const EXOLVE_ORIGIN = "https://api.exolve.ru";
export const PURCHASED_PATH = "/number/customer/v1/GetList";
export const DIRECTORY_PATH = "/number/reference/v1/GetList";
export const FREE_PATH = "/number/v1/GetFree";

export const PURCHASED_LIMIT = 1000;
export const FREE_LIMIT = 500;
export const FREE_OFFSET_MAX = 5_000_000;
export const DEF_TYPE_ID = 1104;
export const ABC_TYPE_ID = 1105;
export const KDU_TYPE_ID = 1106;
export const RUSSIA_REGION_ID = 10084;
export const MOSCOW_REGION_ID = 10230;

/** `false` sends `random: false`. `omit` leaves the field out. */
export type FreeRandomMode = "false" | "omit";

const TYPE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export type PurchasedFilter =
  | { kind: "all" }
  | { kind: "type"; typeName: string }
  | { kind: "category"; typeName: string; categoryId: number }
  | { kind: "region"; typeName: string; categoryId: number; regionId: number };

export type FreeCell = {
  typeId: number;
  categoryId: number;
  regionId: number;
};

export function purchasedUrl(): string {
  return `${EXOLVE_ORIGIN}${PURCHASED_PATH}`;
}

export function directoryUrl(): string {
  return `${EXOLVE_ORIGIN}${DIRECTORY_PATH}`;
}

export function freeUrl(): string {
  return `${EXOLVE_ORIGIN}${FREE_PATH}`;
}

function uint32(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 4_294_967_295;
}

/** Unfiltered body is only limit and offset. A layer adds the directory fields. */
export function purchasedBody(
  filter: PurchasedFilter,
  offset: number,
): Record<string, number | string> | null {
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  const body: Record<string, number | string> = {
    limit: PURCHASED_LIMIT,
    offset,
  };
  if (filter.kind === "all") return body;
  if (!TYPE_NAME.test(filter.typeName)) return null;
  body.type_name = filter.typeName;
  if (filter.kind === "type") return body;
  if (!uint32(filter.categoryId)) return null;
  body.category_id = filter.categoryId;
  if (filter.kind === "category") return body;
  if (!uint32(filter.regionId)) return null;
  body.region_id = filter.regionId;
  return body;
}

/** One directory cell. `random: true` is never sent. */
export function freeBody(
  cell: FreeCell,
  offset: number,
  randomMode: FreeRandomMode = "false",
): Record<string, number | boolean> | null {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > FREE_OFFSET_MAX)
    return null;
  if (!uint32(cell.typeId) || !uint32(cell.categoryId) || !uint32(cell.regionId))
    return null;
  const body: Record<string, number | boolean> = {
    type_id: cell.typeId,
    region_id: cell.regionId,
    category_id: cell.categoryId,
    limit: FREE_LIMIT,
    offset,
  };
  if (randomMode === "false") body.random = false;
  return body;
}

/** The next free offset. Null means a full page would pass the ceiling. */
export function nextFreeOffset(offset: number, got: number): number | null {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(got) || got < 0) return null;
  const next = offset + got;
  if (!Number.isSafeInteger(next) || next > FREE_OFFSET_MAX) return null;
  return next;
}
