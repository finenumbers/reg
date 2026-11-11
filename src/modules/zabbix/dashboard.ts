import { hasPermission } from "@/modules/rbac/permissions";
import {
  readZabbixCache,
  withZabbixLock,
  writeZabbixCache,
  zabbixCacheGeneration,
} from "@/modules/zabbix/cache";
import { loadZabbixRuntime, zabbixRuntimeReady, type ZabbixRuntime } from "@/modules/zabbix/credentials";
import {
  ZABBIX_NEED_GRAPH,
  ZABBIX_PASSWORD_UNREADABLE,
  ZABBIX_SAVE_FIRST,
  ZABBIX_UNAVAILABLE,
  zabbixElementCount,
} from "@/modules/zabbix/messages";
import {
  readZabbixSession,
  type ZabbixCaller,
  type ZabbixMethod,
  type ZabbixSlotRequest,
} from "@/modules/zabbix/session";
import {
  zabbixFailureText,
  zabbixHeaders,
  zabbixPost,
  zabbixRpcBody,
} from "@/modules/zabbix/transport";
import {
  zabbixGraphHeading,
  type ZabbixDashboardBody,
  type ZabbixGraphView,
} from "@/modules/zabbix/types";

const METHODS = new Set<ZabbixMethod>([
  "apiinfo.version",
  "user.login",
  "user.logout",
  "host.get",
  "graph.get",
  "item.get",
  "history.get",
]);

function caller(url: string, signal: AbortSignal): ZabbixCaller {
  let id = 0;
  return (method, params, auth) => {
    if (!METHODS.has(method)) {
      return Promise.reject(new Error("Zabbix отказал."));
    }
    id += 1;
    const token = auth?.bearer ? null : (auth?.token ?? null);
    return zabbixPost({
      url,
      body: zabbixRpcBody({ id, method, params, auth: token }),
      headers: zabbixHeaders(auth),
      signal,
    });
  };
}

function hideSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("…");
}

async function talk<T>(
  runtime: ZabbixRuntime,
  probe: boolean,
  map: (session: Awaited<ReturnType<typeof readZabbixSession>>) => T,
  fail: (detail: string) => T,
): Promise<T> {
  const signal = AbortSignal.timeout(30_000);
  try {
    const session = await readZabbixSession(caller(runtime.url, signal), {
      username: runtime.user,
      password: runtime.password,
      slots: runtime.slots,
      now: new Date(),
      probe,
    });
    return map(session);
  } catch (error) {
    return fail(hideSecret(zabbixFailureText(error), runtime.password));
  }
}

function toGraphs(
  session: Extract<Awaited<ReturnType<typeof readZabbixSession>>, { ok: true }>,
  saved: readonly ZabbixSlotRequest[],
): ZabbixGraphView[] {
  return session.slots.map((slot) => ({
    slot: slot.slot,
    title: zabbixGraphHeading(
      saved.find((item) => item.slot === slot.slot)?.title,
      slot.name,
    ),
    host: slot.host,
    message: slot.message,
    note: slot.note,
    lines: slot.lines,
  }));
}

async function loadDashboard(runtime: ZabbixRuntime): Promise<ZabbixDashboardBody> {
  if (runtime.broken) return { status: "unavailable", message: ZABBIX_UNAVAILABLE };
  if (!zabbixRuntimeReady(runtime)) return { status: "hidden" };
  return talk<ZabbixDashboardBody>(
    runtime,
    false,
    (session) => {
      if (!session.ok) return { status: "unavailable", message: ZABBIX_UNAVAILABLE };
      return { status: "ready", origin: session.origin, graphs: toGraphs(session, runtime.slots) };
    },
    () => ({ status: "unavailable", message: ZABBIX_UNAVAILABLE }),
  );
}

/**
 * Phone-traffic charts for the home dashboard.
 * An error is cached for a minute so a bad password is not tried on every reload.
 */
export async function getZabbixDashboard(
  permissions: readonly string[],
): Promise<ZabbixDashboardBody> {
  if (!hasPermission(permissions, "phones:read")) return { status: "hidden" };
  const runtime = await loadZabbixRuntime();
  if (!zabbixRuntimeReady(runtime) && !runtime.broken) return { status: "hidden" };
  const hit = readZabbixCache(Date.now());
  if (hit) return hit;
  return withZabbixLock(async () => {
    const again = readZabbixCache(Date.now());
    if (again) return again;
    const fresh = await loadZabbixRuntime();
    if (!zabbixRuntimeReady(fresh) && !fresh.broken) return { status: "hidden" };
    const generation = zabbixCacheGeneration();
    const body = await loadDashboard(fresh);
    if (body.status !== "hidden") writeZabbixCache(body, generation, Date.now());
    return body;
  });
}

export type ZabbixProbe = {
  result: "success" | "error";
  detail: string;
  slots: number;
};

/** Saved password only. The request body of the test route has no password. */
export async function probeZabbixAccess(): Promise<ZabbixProbe> {
  return withZabbixLock(async () => {
    const runtime = await loadZabbixRuntime();
    const slots = runtime.slots.length;
    if (runtime.broken) {
      return { result: "error", detail: ZABBIX_PASSWORD_UNREADABLE, slots };
    }
    if (!runtime.url || !runtime.user || !runtime.password) {
      return { result: "error", detail: ZABBIX_SAVE_FIRST, slots };
    }
    if (slots === 0) return { result: "error", detail: ZABBIX_NEED_GRAPH, slots };
    return talk<ZabbixProbe>(
      runtime,
      true,
      (session) => {
        if (!session.ok) return { result: "error", detail: session.detail, slots };
        const failed = session.slots.find((slot) => !slot.ok);
        if (failed) {
          return { result: "error", detail: `График ${failed.slot}: ${failed.detail}`, slots };
        }
        const parts = session.slots.map(
          (slot) => `График ${slot.slot}: ${zabbixElementCount(slot.elements)}`,
        );
        return {
          result: "success",
          detail: `Zabbix ${session.version}. ${parts.join(". ")}.`,
          slots,
        };
      },
      (detail) => ({ result: "error", detail, slots }),
    );
  });
}
