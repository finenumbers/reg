import { describe, expect, it } from "vitest";
import { utcCallWindow } from "@/modules/dashboard/concurrency";
import { readZabbixSession, type ZabbixCaller } from "@/modules/zabbix/session";

const TOKEN = "a".repeat(32);

function caller(version: string, historyType: string): {
  call: ZabbixCaller;
  seen: { method: string; params: Record<string, unknown>; auth: unknown }[];
} {
  const seen: { method: string; params: Record<string, unknown>; auth: unknown }[] = [];
  const call: ZabbixCaller = async (method, params, auth) => {
    seen.push({ method, params, auth });
    if (method === "apiinfo.version") return version;
    if (method === "user.login") return TOKEN;
    if (method === "user.logout") return true;
    if (method === "host.get") {
      return [{ hostid: "1", host: "gw", name: "GW", status: "0" }];
    }
    if (method === "graph.get") {
      return [
        {
          graphid: "9",
          name: "SIP",
          graphtype: "0",
          gitems: [{ itemid: "4", color: "00C800", calc_fnc: "2", sortorder: "0", type: "0" }],
        },
      ];
    }
    if (method === "item.get") {
      return [{ itemid: "4", name: "Sessions", value_type: historyType, units: "" }];
    }
    if (method === "history.get") return [];
    return null;
  };
  return { call, seen };
}

describe("Zabbix session", () => {
  const now = new Date("2026-11-11T03:00:30.000Z");

  it("logs in once with username and reads history with the item type", async () => {
    const { call, seen } = caller("7.0.10", "0");
    const day = utcCallWindow(now);
    const result = await readZabbixSession(call, {
      username: "ops",
      password: "secret",
      slots: [{ slot: 1, host: "gw", name: "SIP" }],
      now,
      probe: false,
    });
    expect(result.ok).toBe(true);
    const login = seen.find((entry) => entry.method === "user.login");
    expect(login?.params).toEqual({ username: "ops", password: "secret" });
    expect(login?.auth).toBeNull();
    const history = seen.find((entry) => entry.method === "history.get");
    expect(history?.params.history).toBe(0);
    expect(history?.params.itemids).toEqual(["4"]);
    expect(history?.params.time_from).toBe(Math.floor(day.recentStart.getTime() / 1000));
    expect(history?.params.time_till).toBe(Math.floor(day.seriesEnd.getTime() / 1000) - 1);
    expect(history?.auth).toEqual({ token: TOKEN, bearer: false });
    expect(seen.at(-1)?.method).toBe("user.logout");
    if (result.ok) {
      expect(result.slots[0]?.lines?.[0]?.minutes).toHaveLength(120);
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });

  it("sends Bearer from 7.2 and still logs out when history fails", async () => {
    const seen: { method: string; auth: unknown }[] = [];
    const call: ZabbixCaller = async (method, params, auth) => {
      seen.push({ method, auth });
      if (method === "apiinfo.version") return "7.2.1";
      if (method === "user.login") {
        expect(params).not.toHaveProperty("user");
        return TOKEN;
      }
      if (method === "user.logout") return true;
      if (method === "host.get") throw new Error("boom");
      return [];
    };
    const result = await readZabbixSession(call, {
      username: "ops",
      password: "secret",
      slots: [{ slot: 1, host: "gw", name: "SIP" }],
      now,
      probe: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.slots[0]?.ok).toBe(false);
    expect(seen.some((entry) => entry.method === "host.get" && entry.auth && (entry.auth as { bearer: boolean }).bearer)).toBe(true);
    expect(seen.at(-1)?.method).toBe("user.logout");
  });

  it("does not try a second login on an old Zabbix", async () => {
    const seen: string[] = [];
    const call: ZabbixCaller = async (method) => {
      seen.push(method);
      if (method === "apiinfo.version") return "5.0.0";
      return null;
    };
    const result = await readZabbixSession(call, {
      username: "ops",
      password: "secret",
      slots: [{ slot: 1, host: "gw", name: "SIP" }],
      now,
      probe: true,
    });
    expect(result).toEqual({ ok: false, detail: "Нужен Zabbix 6.0 или новее." });
    expect(seen).toEqual(["apiinfo.version"]);
  });
});
