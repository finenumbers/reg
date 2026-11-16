import { describe, expect, it } from "vitest";
import {
  AURORA_BODY_CAP,
  collectCapped,
  downloadAuroraCsv,
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
