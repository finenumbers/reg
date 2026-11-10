/** Host and graph rows from Zabbix JSON. Templates and substrings do not match. */

export type ZabbixHostRow = {
  hostid: string;
  host: string;
  name: string;
  status: string;
};

export type ZabbixGraphItemRow = {
  itemid: string;
  color: string;
  calc: string;
  sort: number;
  type: string;
};

export type ZabbixGraphRow = {
  graphid: string;
  name: string;
  graphtype: string;
  items: ZabbixGraphItemRow[];
};

export type ZabbixPick<T> =
  | { ok: true; row: T }
  | { ok: false; reason: "none" | "many" };

const TEMPLATE_STATUS = "3";

export function sameZabbixText(left: string, right: string): boolean {
  return left.localeCompare(right, "ru", { sensitivity: "accent" }) === 0;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return null;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function hostRows(value: unknown): ZabbixHostRow[] {
  if (!Array.isArray(value)) return [];
  const rows: ZabbixHostRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const hostid = idOf(row.hostid);
    if (!hostid) continue;
    rows.push({
      hostid,
      host: textOf(row.host),
      name: textOf(row.name),
      status: row.status == null ? "0" : String(row.status),
    });
  }
  return rows;
}

export function pickHost(
  rows: readonly ZabbixHostRow[],
  query: string,
  mode: "exact" | "loose",
): ZabbixPick<ZabbixHostRow> {
  const q = query.trim();
  const seen = new Set<string>();
  const matched: ZabbixHostRow[] = [];
  for (const row of rows) {
    if (row.status === TEMPLATE_STATUS) continue;
    if (seen.has(row.hostid)) continue;
    const hit =
      mode === "exact"
        ? row.host === q || row.name === q
        : sameZabbixText(row.host, q) || sameZabbixText(row.name, q);
    if (!hit) continue;
    seen.add(row.hostid);
    matched.push(row);
  }
  if (matched.length === 1) return { ok: true, row: matched[0] };
  if (matched.length === 0) return { ok: false, reason: "none" };
  return { ok: false, reason: "many" };
}

function graphItems(value: unknown): ZabbixGraphItemRow[] {
  if (!Array.isArray(value)) return [];
  const items: ZabbixGraphItemRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const itemid = idOf(row.itemid);
    if (!itemid) continue;
    const sort = Number(row.sortorder);
    items.push({
      itemid,
      color: textOf(row.color),
      calc: row.calc_fnc == null ? "2" : String(row.calc_fnc),
      sort: Number.isFinite(sort) ? sort : 0,
      type: row.type == null ? "0" : String(row.type),
    });
  }
  items.sort((left, right) => left.sort - right.sort || left.itemid.localeCompare(right.itemid));
  return items;
}

export function graphRows(value: unknown): ZabbixGraphRow[] {
  if (!Array.isArray(value)) return [];
  const rows: ZabbixGraphRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const graphid = idOf(row.graphid);
    if (!graphid) continue;
    rows.push({
      graphid,
      name: textOf(row.name),
      graphtype: row.graphtype == null ? "0" : String(row.graphtype),
      items: graphItems(row.gitems),
    });
  }
  return rows;
}

export function pickGraph(
  rows: readonly ZabbixGraphRow[],
  query: string,
  mode: "exact" | "loose",
): ZabbixPick<ZabbixGraphRow> {
  const q = query.trim();
  const seen = new Set<string>();
  const matched: ZabbixGraphRow[] = [];
  for (const row of rows) {
    if (seen.has(row.graphid)) continue;
    const hit = mode === "exact" ? row.name === q : sameZabbixText(row.name, q);
    if (!hit) continue;
    seen.add(row.graphid);
    matched.push(row);
  }
  if (matched.length === 1) return { ok: true, row: matched[0] };
  if (matched.length === 0) return { ok: false, reason: "none" };
  return { ok: false, reason: "many" };
}

/** Normal and stacked graphs are time series. Pie and exploded are not. */
export function isTimeSeriesGraph(graphtype: string): boolean {
  return graphtype === "0" || graphtype === "1";
}

export type ZabbixItemRow = {
  itemid: string;
  name: string;
  valueType: string;
  units: string;
};

export function itemRows(value: unknown): ZabbixItemRow[] {
  if (!Array.isArray(value)) return [];
  const rows: ZabbixItemRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const itemid = idOf(row.itemid);
    if (!itemid) continue;
    rows.push({
      itemid,
      name: textOf(row.name),
      valueType: row.value_type == null ? "" : String(row.value_type),
      units: textOf(row.units),
    });
  }
  return rows;
}

/** Float and unsigned history. The default history.get type is unsigned. */
export function isNumericValueType(valueType: string): boolean {
  return valueType === "0" || valueType === "3";
}
