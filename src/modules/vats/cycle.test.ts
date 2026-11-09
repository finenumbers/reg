import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { BossDeps } from "@/modules/vats/client";
import { runVatsPass, type VatsCycleStore } from "@/modules/vats/cycle";
import { MSG_DIALPLANS, MSG_EMPTY, MSG_GATEWAYS, msgSoft } from "@/modules/vats/labels";
import { withBossLock, yieldEventLoop } from "@/modules/vats/lock";
import {
  mergeDomainRows,
  sortDomainRows,
  sortTelnumRows,
  type DomainRow,
  type TelnumRow,
} from "@/modules/vats/rows";
import type { NamedId } from "@/modules/vats/labels";

const auth = {
  origin: "https://platform.example",
  login: "boss-user",
  password: "pw-secret",
};
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

function listen(
  onRequest: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<number> {
  const server = createServer(onRequest);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      closers.push(
        () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      );
      resolve(address.port);
    });
  });
}

function forward(port: number): { deps: BossDeps; seen: string[] } {
  const seen: string[] = [];
  const real = globalThis.fetch;
  const deps: BossDeps = {
    fetchImpl: (input, init) => {
      const url = new URL(String(input));
      seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
      return real(`http://127.0.0.1:${port}${url.pathname}`, {
        method: init?.method,
        headers: init?.headers,
        body: init?.body ?? undefined,
        redirect: init?.redirect,
        signal: init?.signal,
      });
    },
  };
  return { deps, seen };
}

function json(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

type Memory = {
  domains: DomainRow[];
  telnums: TelnumRow[];
  domainNotice: string | null;
  telnumNotice: string | null;
  settingsNotice: string | null;
  domainCommitted: boolean;
  telnumCommitted: boolean;
  gateways: NamedId[];
  routes: string[];
  dialplans: NamedId[];
  complete: boolean;
};

function memoryStore(seed?: Partial<Memory>): { state: Memory; store: VatsCycleStore } {
  const state: Memory = {
    domains: seed?.domains ?? [],
    telnums: seed?.telnums ?? [],
    domainNotice: seed?.domainNotice ?? null,
    telnumNotice: seed?.telnumNotice ?? null,
    settingsNotice: seed?.settingsNotice ?? null,
    domainCommitted: seed?.domainCommitted ?? false,
    telnumCommitted: seed?.telnumCommitted ?? false,
    gateways: [],
    routes: [],
    dialplans: [],
    complete: false,
  };
  const store: VatsCycleStore = {
    readDomains: async () => state.domains,
    readTelnums: async () => state.telnums,
    async commitDomains(input) {
      if (input.rows.length === 0 && state.domains.length > 0) return "kept";
      state.domains = sortDomainRows(
        mergeDomainRows(state.domains, input.rows, input.cardReadAt),
      );
      state.domainNotice = input.notice;
      state.domainCommitted = true;
      return "published";
    },
    async commitTelnums(input) {
      if (input.rows.length === 0 && state.telnums.length > 0) return "kept";
      state.telnums = sortTelnumRows(input.rows);
      state.telnumNotice = input.notice;
      state.telnumCommitted = true;
      return "published";
    },
    async setNotice(section, notice) {
      if (section === "domains") state.domainNotice = notice;
      else if (section === "telnums") state.telnumNotice = notice;
      else state.settingsNotice = notice;
    },
    async saveGateways(rows) {
      state.gateways = rows;
    },
    async saveRoutes(rows) {
      state.routes = rows;
    },
    async saveDialplans(rows) {
      state.dialplans = rows;
    },
    async markCatalogsComplete() {
      state.complete = true;
      state.settingsNotice = null;
      return true;
    },
  };
  return { state, store };
}

const dialplans = [
  { id: "dp-b", name: "Второй" },
  { id: "dp-a", name: "Первый" },
];
const gateways = [
  { id: "gw-1", name: "Север" },
  { id: "gw-2", name: "gw-1" },
];

function domainCard(name: string, dialplan: string) {
  return {
    client: name === "a.example" ? "Альфа" : "Бета",
    accountsCount: 1,
    accountsLimit: 4,
    frozen: name === "b.example",
    dialplan,
  };
}

describe("VATS cycle", () => {
  it("reads catalogs before cards and publishes sorted display fields", async () => {
    const { state, store } = memoryStore();
    const port = await listen((req, res) => {
      if (req.url === "/sys/boss/v1/dialplans") return json(res, dialplans);
      if (req.url === "/sys/boss/v1/domains")
        return json(res, ["b.example", "a.example", "a.example"]);
      if (req.url === "/sys/boss/v1/domains/a.example")
        return json(res, domainCard("a.example", "dp-a"));
      if (req.url === "/sys/boss/v1/domains/b.example")
        return json(res, domainCard("b.example", "missing"));
      if (req.url === "/sys/boss/v1/gateways") return json(res, gateways);
      if (req.url === "/sys/boss/v1/routes") return json(res, [{ id: "route-1" }]);
      if (req.url === "/sys/boss/v1/telnums") return json(res, ["10", "9"]);
      if (req.url === "/sys/boss/v1/telnums/9") {
        return json(res, {
          gateways: ["gw-1", "gw-1"],
          allocatedTo: "a.example",
          isFmc: false,
        });
      }
      if (req.url === "/sys/boss/v1/telnums/10") {
        return json(res, { gateways: ["plain"], allocatedTo: "nope/path", isFmc: true });
      }
      json(res, { error: "missing" }, 500);
    });
    const { deps, seen } = forward(port);
    const result = await runVatsPass({
      auth,
      deps,
      store,
      hooks: { yield: async () => undefined },
    });
    expect(seen.map((line) => line.replace("GET ", ""))).toEqual([
      "/sys/boss/v1/dialplans",
      "/sys/boss/v1/domains",
      "/sys/boss/v1/domains/b.example",
      "/sys/boss/v1/domains/a.example",
      "/sys/boss/v1/gateways",
      "/sys/boss/v1/routes",
      "/sys/boss/v1/telnums",
      "/sys/boss/v1/telnums/10",
      "/sys/boss/v1/telnums/9",
    ]);
    expect(state.domains.map((row) => row.name)).toEqual(["a.example", "b.example"]);
    expect(state.domains[0]).toMatchObject({
      client: "Альфа",
      accountsCount: 1,
      accountsLimit: 4,
      dialplan: "Первый",
      frozen: false,
    });
    expect(state.domains[1]?.dialplan).toBeNull();
    expect(state.telnums.map((row) => row.telnum)).toEqual(["9", "10"]);
    expect(state.telnums[0]?.gateways).toEqual(["Север", "Север"]);
    expect(state.telnums[1]?.gateways).toEqual([]);
    expect(state.telnums[1]?.domain).toBeNull();
    expect(state.routes).toEqual(["route-1"]);
    expect(result.domains).toBe("published");
    expect(result.telnums).toBe("published");
    expect(result.settingsComplete).toBe(true);
    expect(result.platformFailure).toBe(false);
  });

  it("does not read domain cards when dialplans fail, and skips numbers when gateways fail", async () => {
    const { state, store } = memoryStore({
      domains: [
        {
          name: "a.example",
          client: "Было",
          clientAt: null,
          accountsCount: 2,
          accountsLimit: 2,
          dialplan: "Старый",
          frozen: false,
        },
      ],
    });
    const port = await listen((req, res) => {
      if (req.url === "/sys/boss/v1/dialplans") return json(res, {}, 500);
      if (req.url === "/sys/boss/v1/gateways") return json(res, {}, 500);
      if (req.url === "/sys/boss/v1/routes") return json(res, ["route-1"]);
      json(res, ["should-not-run"]);
    });
    const { deps, seen } = forward(port);
    const result = await runVatsPass({
      auth,
      deps,
      store,
      hooks: { yield: async () => undefined },
    });
    expect(seen.some((line) => line.includes("/domains"))).toBe(false);
    expect(seen.some((line) => line.includes("/telnums"))).toBe(false);
    expect(state.domains[0]?.client).toBe("Было");
    expect(state.domainCommitted).toBe(false);
    expect(state.domainNotice).toBe(MSG_DIALPLANS);
    expect(state.telnumNotice).toBe(MSG_GATEWAYS);
    expect(state.settingsNotice).toContain(MSG_DIALPLANS);
    expect(result.platformFailure).toBe(true);
    expect(result.domains).toBe("skipped");
  });

  it("does not publish cards already read when a later card fails", async () => {
    const { state, store } = memoryStore({
      domains: [
        {
          name: "a.example",
          client: "Было",
          clientAt: null,
          accountsCount: null,
          accountsLimit: null,
          dialplan: null,
          frozen: null,
        },
      ],
    });
    const port = await listen((req, res) => {
      if (req.url === "/sys/boss/v1/dialplans") return json(res, dialplans);
      if (req.url === "/sys/boss/v1/domains")
        return json(res, ["a.example", "b.example"]);
      if (req.url === "/sys/boss/v1/domains/a.example")
        return json(res, domainCard("a.example", "dp-a"));
      if (req.url === "/sys/boss/v1/domains/b.example") return json(res, {}, 500);
      json(res, []);
    });
    const { deps } = forward(port);
    const result = await runVatsPass({
      auth,
      deps,
      store,
      hooks: { yield: async () => undefined },
    });
    expect(state.domainCommitted).toBe(false);
    expect(state.domains[0]?.client).toBe("Было");
    expect(result.domains).toBe("skipped");
    expect(state.domainNotice).toContain("Снимок не изменён");
  });

  it("stops the whole cycle on 401 and writes the notice on every section", async () => {
    const { state, store } = memoryStore();
    const port = await listen((req, res) => {
      if (req.url === "/sys/boss/v1/dialplans") return json(res, dialplans);
      if (req.url === "/sys/boss/v1/domains") return json(res, {}, 401);
      json(res, ["should-not-run"]);
    });
    const { deps, seen } = forward(port);
    const result = await runVatsPass({
      auth,
      deps,
      store,
      hooks: { yield: async () => undefined },
    });
    expect(seen).toEqual(["GET /sys/boss/v1/dialplans", "GET /sys/boss/v1/domains"]);
    expect(state.domainNotice).toContain("не приняты");
    expect(state.telnumNotice).toBe(state.domainNotice);
    expect(state.settingsNotice).toBe(state.domainNotice);
    expect(result.platformFailure).toBe(true);
    expect(result.settingsComplete).toBe(false);
  });

  it("does not publish on the sixth unread card and does publish one kept row", async () => {
    const names = [
      "a1.example",
      "a2.example",
      "a3.example",
      "a4.example",
      "a5.example",
      "a6.example",
    ];
    const previous: DomainRow = {
      name: "a2.example",
      client: "Живой",
      clientAt: null,
      accountsCount: 3,
      accountsLimit: 9,
      dialplan: "Старый",
      frozen: true,
    };
    const held = memoryStore({ domains: [previous] });
    const port = await listen((req, res) => {
      if (req.url === "/sys/boss/v1/dialplans") return json(res, dialplans);
      if (req.url === "/sys/boss/v1/domains") return json(res, names);
      if (req.url?.startsWith("/sys/boss/v1/domains/")) return json(res, {}, 404);
      json(res, []);
    });
    const many = forward(port);
    const failed = await runVatsPass({
      auth,
      deps: many.deps,
      store: held.store,
      hooks: { yield: async () => undefined },
    });
    expect(failed.domains).toBe("skipped");
    expect(held.state.domainCommitted).toBe(false);
    expect(held.state.domains[0]?.client).toBe("Живой");

    const one = memoryStore({ domains: [previous] });
    const second = await listen((req, res) => {
      if (req.url === "/sys/boss/v1/dialplans") return json(res, dialplans);
      if (req.url === "/sys/boss/v1/domains")
        return json(res, ["a.example", "a2.example"]);
      if (req.url === "/sys/boss/v1/domains/a2.example") return json(res, {}, 404);
      if (req.url === "/sys/boss/v1/domains/a.example")
        return json(res, domainCard("a.example", "dp-a"));
      if (req.url === "/sys/boss/v1/gateways") return json(res, gateways);
      if (req.url === "/sys/boss/v1/routes") return json(res, []);
      if (req.url === "/sys/boss/v1/telnums") return json(res, []);
      json(res, {}, 500);
    });
    const rest = forward(second);
    const published = await runVatsPass({
      auth,
      deps: rest.deps,
      store: one.store,
      hooks: { yield: async () => undefined },
    });
    expect(published.domains).toBe("published");
    expect(one.state.domainNotice).toBe(msgSoft(1));
    const kept = one.state.domains.find((row) => row.name === "a2.example");
    expect(kept?.client).toBe("Живой");
    expect(one.state.domains.map((row) => row.name)).toEqual(["a.example", "a2.example"]);
  });

  it("keeps a stored list when the platform returns an empty one", async () => {
    const { state, store } = memoryStore({
      domains: [
        {
          name: "a.example",
          client: null,
          clientAt: null,
          accountsCount: null,
          accountsLimit: null,
          dialplan: null,
          frozen: null,
        },
      ],
      telnums: [{ telnum: "9", domain: null, isFmc: null, gateways: [] }],
    });
    const port = await listen((req, res) => {
      if (req.url === "/sys/boss/v1/dialplans") return json(res, []);
      if (req.url === "/sys/boss/v1/domains") return json(res, []);
      if (req.url === "/sys/boss/v1/gateways") return json(res, []);
      if (req.url === "/sys/boss/v1/routes") return json(res, []);
      if (req.url === "/sys/boss/v1/telnums") return json(res, []);
      json(res, {}, 500);
    });
    const { deps, seen } = forward(port);
    await runVatsPass({ auth, deps, store, hooks: { yield: async () => undefined } });
    expect(seen.some((line) => line.includes("/domains/"))).toBe(false);
    expect(state.domains).toHaveLength(1);
    expect(state.telnums).toHaveLength(1);
    expect(state.domainNotice).toBe(MSG_EMPTY);
    expect(state.telnumNotice).toBe(MSG_EMPTY);
    expect(state.domainCommitted).toBe(false);
  });

  it("drops a pass when settings change and keeps a newer client stamp", async () => {
    let generation = 1;
    const { state, store } = memoryStore({
      domains: [
        {
          name: "a.example",
          client: "Старый",
          clientAt: null,
          accountsCount: null,
          accountsLimit: null,
          dialplan: null,
          frozen: null,
        },
      ],
    });
    const port = await listen((req, res) => {
      if (req.url === "/sys/boss/v1/dialplans") {
        generation = 2;
        return json(res, dialplans);
      }
      if (req.url === "/sys/boss/v1/domains/a.example") {
        state.domains = [
          {
            name: "a.example",
            client: "Новый",
            clientAt: "2020-01-01T00:00:02.000Z",
            accountsCount: null,
            accountsLimit: null,
            dialplan: null,
            frozen: null,
          },
        ];
        return json(res, domainCard("a.example", "dp-a"));
      }
      if (req.url === "/sys/boss/v1/domains") return json(res, ["a.example"]);
      json(res, []);
    });
    const changed = forward(port);
    const aborted = await runVatsPass({
      auth,
      deps: changed.deps,
      store,
      hooks: {
        generation: () => generation,
        yield: async () => undefined,
      },
    });
    expect(aborted.aborted).toBe(true);
    expect(aborted.called).toBe(true);
    expect(aborted.platformFailure).toBe(false);
    expect(state.domainCommitted).toBe(false);
    expect(changed.seen.some((line) => line.includes("/domains"))).toBe(false);

    generation = 1;
    const stamp = memoryStore({
      domains: [
        {
          name: "a.example",
          client: "Старый",
          clientAt: null,
          accountsCount: null,
          accountsLimit: null,
          dialplan: null,
          frozen: null,
        },
      ],
    });
    const again = await listen((req, res) => {
      if (req.url === "/sys/boss/v1/dialplans") return json(res, dialplans);
      if (req.url === "/sys/boss/v1/domains") return json(res, ["a.example"]);
      if (req.url === "/sys/boss/v1/domains/a.example") {
        stamp.state.domains = [
          {
            name: "a.example",
            client: "Новый",
            clientAt: "2020-01-01T00:00:02.000Z",
            accountsCount: null,
            accountsLimit: null,
            dialplan: null,
            frozen: null,
          },
        ];
        return json(res, { ...domainCard("a.example", "dp-a"), client: "С карточки" });
      }
      if (req.url === "/sys/boss/v1/gateways") return json(res, []);
      if (req.url === "/sys/boss/v1/routes") return json(res, []);
      if (req.url === "/sys/boss/v1/telnums") return json(res, []);
      json(res, {}, 500);
    });
    const stamped = forward(again);
    await runVatsPass({
      auth,
      deps: stamped.deps,
      store: stamp.store,
      hooks: {
        now: () => Date.parse("2020-01-01T00:00:00.000Z"),
        yield: async () => undefined,
      },
    });
    expect(stamp.state.domains[0]?.client).toBe("Новый");
    expect(stamp.state.domainCommitted).toBe(true);
  });

  it("lets a waiting operator read before the next card", async () => {
    const order: string[] = [];
    const { store } = memoryStore();
    const port = await listen((req, res) => {
      if (req.url === "/sys/boss/v1/dialplans") return json(res, dialplans);
      if (req.url === "/sys/boss/v1/domains")
        return json(res, ["a.example", "b.example"]);
      if (req.url === "/sys/boss/v1/domains/a.example") {
        order.push("a");
        void withBossLock(async () => {
          order.push("operator");
        });
        return json(res, domainCard("a.example", "dp-a"));
      }
      if (req.url === "/sys/boss/v1/domains/b.example") {
        order.push("b");
        return json(res, domainCard("b.example", "dp-a"));
      }
      json(res, []);
    });
    const { deps } = forward(port);
    await runVatsPass({
      auth,
      deps,
      store,
      hooks: { yield: yieldEventLoop },
    });
    expect(order).toEqual(["a", "operator", "b"]);
  });
});
