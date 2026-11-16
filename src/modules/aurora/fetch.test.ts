import http from "node:http";
import { describe, expect, it } from "vitest";
import {
  AURORA_BODY_CAP,
  collectCapped,
  downloadAuroraCsv,
  fetchAuroraOnce,
  resolveAuroraHost,
  type AuroraFetchFailure,
  type AuroraOnce,
} from "@/modules/aurora/fetch";

const quiet: AuroraFetchFailure = {
  ok: false,
  error: "Ссылка не отвечает.",
  retryable: true,
  status: 503,
};

function closed(): AuroraFetchFailure {
  return {
    ok: false,
    error: "Ссылка ведёт на закрытый адрес.",
    retryable: false,
    status: 0,
  };
}

describe("Aurora download", () => {
  it("does not connect when a name resolves to a private address", async () => {
    const resolved = await resolveAuroraHost("files.example.com", async () => [
      { address: "10.1.1.1", family: 4 },
    ]);
    expect(resolved.ok).toBe(false);
    const loopback = await resolveAuroraHost("files.example.com", async () => [
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(loopback.ok).toBe(false);
    const once = viOnce();
    const result = await downloadAuroraCsv(
      { href: "https://files.example.com/a.csv", host: "files.example.com" },
      new AbortController().signal,
      { resolve: async () => closed(), once: once.fn },
    );
    expect(result.ok).toBe(false);
    expect(once.calls).toBe(0);
  });

  it("repeats a server failure once and does not repeat a rejection or a redirect", async () => {
    const server = viOnce();
    server.fn = failingThenOk(server);
    const ok = await downloadAuroraCsv(link, new AbortController().signal, {
      resolve: publicResolve,
      once: (...args) => server.fn(...args),
    });
    expect(ok.ok).toBe(true);
    expect(server.calls).toBe(2);

    const rejected = viOnce();
    await downloadAuroraCsv(link, new AbortController().signal, {
      resolve: publicResolve,
      once: async () => {
        rejected.calls += 1;
        return { ok: false, error: "Ссылка отклонена.", retryable: false, status: 404 };
      },
    });
    expect(rejected.calls).toBe(1);

    const redirect = viOnce();
    const moved = await downloadAuroraCsv(link, new AbortController().signal, {
      resolve: publicResolve,
      once: async () => {
        redirect.calls += 1;
        return {
          ok: false,
          error: "Ссылка перенаправляет. Укажите прямой адрес.",
          retryable: false,
          status: 302,
        };
      },
    });
    expect(redirect.calls).toBe(1);
    expect(moved.ok).toBe(false);
  });

  it("reads http on the saved port and does not follow a redirect", async () => {
    const seen: { url?: string; host?: string }[] = [];
    const server = http.createServer((request, response) => {
      seen.push({ url: request.url, host: request.headers.host });
      if (request.url === "/moved.csv") {
        response.writeHead(302, { Location: "/secret.csv" });
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/csv" });
      response.end("column");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const bound = server.address();
    const port = typeof bound === "object" && bound ? bound.port : 0;
    const signal = new AbortController().signal;
    try {
      const ok = await fetchAuroraOnce(
        `http://files.example.com:${port}/a.csv`,
        "files.example.com",
        { address: "127.0.0.1", family: 4 },
        signal,
      );
      expect(ok.ok).toBe(true);
      if (!ok.ok) return;
      expect(Buffer.from(ok.bytes).toString()).toBe("column");
      expect(seen[0]?.host).toBe(`files.example.com:${port}`);
      expect(seen[0]?.url).toBe("/a.csv");

      const moved = await fetchAuroraOnce(
        `http://files.example.com:${port}/moved.csv`,
        "files.example.com",
        { address: "127.0.0.1", family: 4 },
        signal,
      );
      expect(moved.ok).toBe(false);
      if (moved.ok) return;
      expect(moved.error).toBe("Ссылка перенаправляет. Укажите прямой адрес.");
      expect(moved.error).not.toContain("://");
      expect(seen.some((hit) => hit.url === "/secret.csv")).toBe(false);

      const closed = await fetchAuroraOnce(
        "http://files.example.com:1/a.csv",
        "files.example.com",
        { address: "127.0.0.1", family: 4 },
        signal,
      );
      expect(closed.ok).toBe(false);
      if (closed.ok) return;
      expect(closed.error).toBe("Ссылка не отвечает.");
      expect(closed.error).not.toContain("://");

      const foreign = await fetchAuroraOnce(
        `http://other.example:${port}/a.csv`,
        "files.example.com",
        { address: "127.0.0.1", family: 4 },
        signal,
      );
      expect(foreign.ok).toBe(false);
      if (foreign.ok) return;
      expect(foreign.error).toBe("Ссылка отклонена.");
      expect(seen.filter((hit) => hit.url === "/a.csv")).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it("stops when the body is larger than 20 MB", () => {
    const chunk = new Uint8Array(AURORA_BODY_CAP + 1);
    const result = collectCapped([chunk]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(false);
    expect(result.error).toBe("Файл больше 20 МБ.");
  });
});

const link = { href: "https://files.example.com/a.csv", host: "files.example.com" };

function publicResolve(): ReturnType<typeof resolveAuroraHost> {
  return Promise.resolve({
    ok: true,
    addresses: [{ address: "8.8.8.8", family: 4 }],
  });
}

function viOnce(): { calls: number; fn: AuroraOnce } {
  const state: { calls: number; fn: AuroraOnce } = {
    calls: 0,
    fn: async () => quiet,
  };
  return state;
}

function failingThenOk(state: { calls: number }): AuroraOnce {
  return async () => {
    state.calls += 1;
    if (state.calls === 1) return quiet;
    return { ok: true, bytes: Uint8Array.of(1), status: 200 };
  };
}
