import { describe, expect, it } from "vitest";
import { parseZabbixApiUrl } from "@/modules/zabbix/url";
import { zabbixAuthKind, zabbixSessionToken } from "@/modules/zabbix/version";
import { zabbixHeaders, zabbixRpcBody } from "@/modules/zabbix/transport";

describe("Zabbix API URL", () => {
  it("appends api_jsonrpc.php and keeps an address that already has it", () => {
    expect(parseZabbixApiUrl("https://zabbix.example/zabbix")).toBe(
      "https://zabbix.example/zabbix/api_jsonrpc.php",
    );
    expect(parseZabbixApiUrl("https://zabbix.example/zabbix/api_jsonrpc.php")).toBe(
      "https://zabbix.example/zabbix/api_jsonrpc.php",
    );
    expect(parseZabbixApiUrl("https://zabbix.example:8443")).toBe(
      "https://zabbix.example:8443/api_jsonrpc.php",
    );
    expect(parseZabbixApiUrl("  ")).toBeNull();
  });

  it("rejects http, userinfo, query, and parent segments", () => {
    expect(parseZabbixApiUrl("http://zabbix.example")).toBeNull();
    expect(parseZabbixApiUrl("https://ops:secret@zabbix.example/zabbix")).toBeNull();
    expect(parseZabbixApiUrl("https://zabbix.example/zabbix?token=1")).toBeNull();
    expect(parseZabbixApiUrl("https://zabbix.example/zabbix#frag")).toBeNull();
    expect(parseZabbixApiUrl("https://zabbix.example/a/../api_jsonrpc.php")).toBeNull();
  });
});

describe("Zabbix session auth", () => {
  it("uses the JSON auth field before 7.2 and Bearer from 7.2", () => {
    expect(zabbixAuthKind("6.0.32")).toBe("auth");
    expect(zabbixAuthKind("6.4.0")).toBe("auth");
    expect(zabbixAuthKind("7.0.11")).toBe("auth");
    expect(zabbixAuthKind("7.2.0")).toBe("bearer");
    expect(zabbixAuthKind("5.4.0")).toBeNull();
    expect(zabbixAuthKind("nope")).toBeNull();
  });

  it("does not put a session token on the Authorization header before 7.2", () => {
    const token = "a".repeat(32);
    expect(zabbixSessionToken(token)).toBe(token);
    expect(zabbixSessionToken("not a token")).toBeNull();
    expect(zabbixHeaders(null).Authorization).toBeUndefined();
    expect(zabbixHeaders({ token, bearer: false }).Authorization).toBeUndefined();
    expect(zabbixHeaders({ token, bearer: true }).Authorization).toBe(`Bearer ${token}`);
    const login = JSON.parse(
      zabbixRpcBody({
        id: 1,
        method: "user.login",
        params: { username: "ops", password: "secret" },
        auth: null,
      }),
    );
    expect(login).not.toHaveProperty("auth");
    expect(login.params).not.toHaveProperty("user");
    const host = JSON.parse(
      zabbixRpcBody({
        id: 2,
        method: "host.get",
        params: { output: ["hostid"] },
        auth: token,
      }),
    );
    expect(host.auth).toBe(token);
    expect(host.params.password).toBeUndefined();
  });
});
