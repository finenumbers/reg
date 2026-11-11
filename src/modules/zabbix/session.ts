import { TWO_HOUR_MINUTES, utcCallWindow } from "@/modules/dashboard/concurrency";
import {
  bucketFn,
  bucketHistory,
  historyPoints,
  ZABBIX_HISTORY_LIMIT,
  ZABBIX_LINE_CAP,
} from "@/modules/zabbix/bucket";
import {
  ZABBIX_AMBIGUOUS,
  ZABBIX_HISTORY,
  ZABBIX_HOST_MANY,
  ZABBIX_HOST_NONE,
  ZABBIX_GRAPH_MANY,
  ZABBIX_GRAPH_NONE,
  ZABBIX_NO_ITEMS,
  ZABBIX_NO_SESSION,
  ZABBIX_NO_VERSION,
  ZABBIX_NOT_FOUND,
  ZABBIX_NOT_SERIES,
  ZABBIX_TOO_OLD,
  ZABBIX_UNAVAILABLE,
  zabbixGraphNotes,
} from "@/modules/zabbix/messages";
import {
  graphRows,
  hostRows,
  isNumericValueType,
  isTimeSeriesGraph,
  itemRows,
  pickGraph,
  pickHost,
  type ZabbixGraphItemRow,
  type ZabbixItemRow,
} from "@/modules/zabbix/resolve";
import { zabbixStroke } from "@/modules/zabbix/scale";
import { ZabbixFailure, zabbixFailureText } from "@/modules/zabbix/transport";
import { zabbixAuthKind, zabbixSessionToken } from "@/modules/zabbix/version";

export type ZabbixMethod =
  | "apiinfo.version"
  | "user.login"
  | "user.logout"
  | "host.get"
  | "graph.get"
  | "item.get"
  | "history.get";

export type ZabbixAuth = { token: string; bearer: boolean } | null;

export type ZabbixCaller = (
  method: ZabbixMethod,
  params: Record<string, unknown>,
  auth: ZabbixAuth,
) => Promise<unknown>;

export type ZabbixSlotRequest = {
  slot: 1 | 2;
  host: string;
  name: string;
  /** Dashboard heading. Empty keeps the Zabbix graph name. */
  title?: string;
};

export type ZabbixLineRead = {
  id: string;
  label: string;
  unit: string;
  color: string;
  minutes: (number | null)[];
};

export type ZabbixSlotRead = {
  slot: 1 | 2;
  host: string;
  name: string;
  ok: boolean;
  detail: string;
  message: string | null;
  note: string | null;
  lines: ZabbixLineRead[] | null;
  elements: number;
};

export type ZabbixSessionRead =
  | { ok: false; detail: string }
  | { ok: true; version: string; origin: string; slots: ZabbixSlotRead[] };

const HOST_OUTPUT = ["hostid", "host", "name", "status"];
const GRAPH_OUTPUT = ["graphid", "name", "graphtype"];
const GRAPH_ITEMS = ["itemid", "color", "calc_fnc", "sortorder", "type"];

function hideSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("…");
}

function failedSlot(
  slot: ZabbixSlotRequest,
  detail: string,
  message: string,
): ZabbixSlotRead {
  return {
    slot: slot.slot,
    host: slot.host,
    name: slot.name,
    ok: false,
    detail,
    message,
    note: null,
    lines: null,
    elements: 0,
  };
}

function stopsTheRest(error: unknown): boolean {
  return (
    error instanceof ZabbixFailure &&
    (error.kind === "timeout" ||
      error.kind === "network" ||
      error.kind === "tls" ||
      error.kind === "redirect")
  );
}

async function findHost(call: ZabbixCaller, query: string, auth: ZabbixAuth) {
  const output = { output: HOST_OUTPUT };
  const byHost = hostRows(
    await call("host.get", { ...output, filter: { host: [query] } }, auth),
  );
  const byName = hostRows(
    await call("host.get", { ...output, filter: { name: [query] } }, auth),
  );
  const exact = pickHost([...byHost, ...byName], query, "exact");
  if (exact.ok) return exact;
  if (exact.reason === "many") return exact;
  const searched = hostRows(
    await call(
      "host.get",
      {
        ...output,
        search: { host: query, name: query },
        searchByAny: true,
        limit: 50,
      },
      auth,
    ),
  );
  return pickHost(searched, query, "loose");
}

async function findGraph(
  call: ZabbixCaller,
  hostid: string,
  query: string,
  auth: ZabbixAuth,
) {
  const output = {
    output: GRAPH_OUTPUT,
    hostids: [hostid],
    selectGraphItems: GRAPH_ITEMS,
  };
  const exactRows = graphRows(
    await call("graph.get", { ...output, filter: { name: [query] } }, auth),
  );
  const exact = pickGraph(exactRows, query, "exact");
  if (exact.ok) return exact;
  if (exact.reason === "many") return exact;
  const searched = graphRows(
    await call(
      "graph.get",
      { ...output, search: { name: query }, limit: 50 },
      auth,
    ),
  );
  return pickGraph(searched, query, "loose");
}

async function readSlot(
  call: ZabbixCaller,
  slot: ZabbixSlotRequest,
  auth: ZabbixAuth,
  window: { originMs: number; fromSec: number; tillSec: number },
  probe: boolean,
): Promise<ZabbixSlotRead> {
  const host = await findHost(call, slot.host, auth);
  if (!host.ok) {
    return failedSlot(
      slot,
      host.reason === "many" ? ZABBIX_HOST_MANY : ZABBIX_HOST_NONE,
      host.reason === "many" ? ZABBIX_AMBIGUOUS : ZABBIX_NOT_FOUND,
    );
  }
  const graph = await findGraph(call, host.row.hostid, slot.name, auth);
  if (!graph.ok) {
    return failedSlot(
      slot,
      graph.reason === "many" ? ZABBIX_GRAPH_MANY : ZABBIX_GRAPH_NONE,
      graph.reason === "many" ? ZABBIX_AMBIGUOUS : ZABBIX_NOT_FOUND,
    );
  }
  if (!isTimeSeriesGraph(graph.row.graphtype)) {
    return failedSlot(slot, ZABBIX_NOT_SERIES, ZABBIX_NOT_SERIES);
  }
  const simple = graph.row.items.filter((item) => item.type === "0");
  if (simple.length === 0) return failedSlot(slot, ZABBIX_NO_ITEMS, ZABBIX_NO_ITEMS);
  const catalog = new Map(
    itemRows(
      await call(
        "item.get",
        {
          output: ["itemid", "name", "value_type", "units"],
          itemids: simple.map((item) => item.itemid),
        },
        auth,
      ),
    ).map((item) => [item.itemid, item]),
  );
  const numeric: { item: ZabbixGraphItemRow; row: ZabbixItemRow }[] = [];
  for (const item of simple) {
    const row = catalog.get(item.itemid);
    if (!row || !isNumericValueType(row.valueType)) continue;
    numeric.push({ item, row });
  }
  if (numeric.length === 0) return failedSlot(slot, ZABBIX_NO_ITEMS, ZABBIX_NO_ITEMS);
  const shown = numeric.slice(0, ZABBIX_LINE_CAP);
  if (probe) {
    const first = shown[0];
    if (!first) return failedSlot(slot, ZABBIX_NO_ITEMS, ZABBIX_NO_ITEMS);
    try {
      const sample = await call(
        "history.get",
        historyParams(first.row, window, 1),
        auth,
      );
      if (!Array.isArray(sample)) return failedSlot(slot, ZABBIX_HISTORY, ZABBIX_UNAVAILABLE);
    } catch (error) {
      if (error instanceof ZabbixFailure && error.kind === "size") {
        return failedSlot(slot, ZABBIX_HISTORY, ZABBIX_UNAVAILABLE);
      }
      throw error;
    }
    return {
      slot: slot.slot,
      host: slot.host,
      name: slot.name,
      ok: true,
      detail: "",
      message: null,
      note: null,
      lines: null,
      elements: numeric.length,
    };
  }

  const lines: ZabbixLineRead[] = [];
  let truncated = false;
  let unread = false;
  for (const entry of shown) {
    try {
      const raw = await call(
        "history.get",
        historyParams(entry.row, window, ZABBIX_HISTORY_LIMIT),
        auth,
      );
      const points = historyPoints(raw);
      const hitLimit = Array.isArray(raw) && raw.length >= ZABBIX_HISTORY_LIMIT;
      const bucket = bucketHistory({
        points,
        originMs: window.originMs,
        minutes: TWO_HOUR_MINUTES,
        fn: bucketFn(entry.item.calc),
        truncated: hitLimit,
      });
      if (bucket.truncated || !bucket.minutes) {
        truncated = true;
        continue;
      }
      lines.push({
        id: entry.row.itemid,
        label: entry.row.name || entry.row.itemid,
        unit: entry.row.units,
        color: zabbixStroke(entry.item.color),
        minutes: bucket.minutes,
      });
    } catch (error) {
      if (error instanceof ZabbixFailure && error.kind === "size") {
        truncated = true;
        continue;
      }
      if (error instanceof ZabbixFailure && error.kind === "rpc") {
        unread = true;
        continue;
      }
      throw error;
    }
  }
  if (lines.length === 0 && (truncated || unread)) {
    return failedSlot(slot, ZABBIX_HISTORY, ZABBIX_UNAVAILABLE);
  }
  const units = new Set(lines.map((line) => line.unit));
  return {
    slot: slot.slot,
    host: slot.host,
    name: slot.name,
    ok: true,
    detail: "",
    message: null,
    note: zabbixGraphNotes({
      shown: lines.length,
      total: numeric.length,
      mixed: units.size > 1,
      truncated,
      unread,
    }),
    lines,
    elements: numeric.length,
  };
}

function historyParams(
  item: ZabbixItemRow,
  window: { fromSec: number; tillSec: number },
  limit: number,
): Record<string, unknown> {
  return {
    output: ["clock", "value"],
    history: Number(item.valueType),
    itemids: [item.itemid],
    time_from: window.fromSec,
    time_till: window.tillSec,
    limit,
  };
}

/**
 * One login, then each configured graph. Logout runs even when a graph fails.
 * `probe` reads one history row and does not build a chart.
 */
export async function readZabbixSession(
  call: ZabbixCaller,
  input: {
    username: string;
    password: string;
    slots: readonly ZabbixSlotRequest[];
    now: Date;
    probe: boolean;
  },
): Promise<ZabbixSessionRead> {
  const password = input.password;
  let token: string | null = null;
  let bearer = false;
  try {
    const versionRaw = await call("apiinfo.version", {}, null);
    if (typeof versionRaw !== "string" || !versionRaw.trim()) {
      return { ok: false, detail: ZABBIX_NO_VERSION };
    }
    const version = versionRaw.trim();
    const kind = zabbixAuthKind(version);
    if (!kind) return { ok: false, detail: ZABBIX_TOO_OLD };
    const login = await call(
      "user.login",
      { username: input.username, password },
      null,
    );
    token = zabbixSessionToken(login);
    if (!token) return { ok: false, detail: ZABBIX_NO_SESSION };
    bearer = kind === "bearer";
    const auth = { token, bearer };
    const day = utcCallWindow(input.now);
    const originMs = day.recentStart.getTime();
    const window = {
      originMs,
      fromSec: Math.floor(originMs / 1000),
      tillSec: Math.floor(day.seriesEnd.getTime() / 1000) - 1,
    };
    const slots: ZabbixSlotRead[] = [];
    for (let index = 0; index < input.slots.length; index += 1) {
      const slot = input.slots[index];
      if (!slot) continue;
      try {
        slots.push(await readSlot(call, slot, auth, window, input.probe));
      } catch (error) {
        const detail = hideSecret(zabbixFailureText(error), password);
        slots.push(failedSlot(slot, detail, ZABBIX_UNAVAILABLE));
        if (stopsTheRest(error)) {
          for (const rest of input.slots.slice(index + 1)) {
            slots.push(failedSlot(rest, detail, ZABBIX_UNAVAILABLE));
          }
          break;
        }
      }
    }
    return {
      ok: true,
      version,
      origin: new Date(originMs).toISOString(),
      slots,
    };
  } catch (error) {
    return { ok: false, detail: hideSecret(zabbixFailureText(error), password) };
  } finally {
    if (token) {
      try {
        await call("user.logout", {}, { token, bearer });
      } catch {
        // A failed logout does not hide a graph that was already read.
      }
    }
  }
}
