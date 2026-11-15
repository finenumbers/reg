import { beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.fn();

vi.mock("@/lib/logger", () => ({
  logger: { info: (...args: unknown[]) => info(...args), warn: vi.fn(), error: vi.fn() },
}));

import { runexisLogin, runexisRead, runexisShowcase } from "@/modules/runexis/client";

describe("runexis client", () => {
  beforeEach(() => {
    info.mockClear();
  });

  it("posts the login and does not log the password", async () => {
    let href = "";
    let init: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, next) => {
      href = String(input);
      init = next;
      return new Response(JSON.stringify({ success: true, data: { token: "tok" } }), {
        status: 200,
      });
    };
    const page = await runexisLogin("a@b.c", "secret", { fetchImpl });
    expect(page.ok).toBe(true);
    expect(href).toBe("https://didapi.runexis.ru/api/v1/login");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual({
      email: "a@b.c",
      password: "secret",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(info.mock.calls)).not.toContain("tok");
  });

  it("sends one showcase page and retries only a transport or 5xx", async () => {
    const denied = vi.fn(async () => new Response("no", { status: 401 }));
    const deniedPage = await runexisShowcase("tok", 1, { fetchImpl: denied });
    expect(denied).toHaveBeenCalledTimes(1);
    expect(deniedPage.ok).toBe(false);
    if (!deniedPage.ok) {
      expect(deniedPage.error).toContain("Площадка отклонила доступ.");
      expect(deniedPage.error).toContain("HTTP 401");
      expect(deniedPage.error).toContain("попыток 1");
      expect(deniedPage.error).not.toContain("://");
    }

    const failed = vi.fn(async () => new Response("down", { status: 500 }));
    await runexisShowcase("tok", 1, { fetchImpl: failed });
    expect(failed).toHaveBeenCalledTimes(2);

    let href = "";
    const ok: typeof fetch = async (input, init) => {
      href = String(input);
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer tok");
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          meta: { total: 0, page: 1, limit: 30 },
        }),
        { status: 200 },
      );
    };
    const page = await runexisShowcase("tok", 1, { fetchImpl: ok });
    expect(page.ok).toBe(true);
    const url = new URL(href);
    expect([...url.searchParams.keys()].sort()).toEqual(["limit", "page"]);
    expect(JSON.stringify(info.mock.calls)).not.toContain("tok");
    expect(JSON.stringify(info.mock.calls)).not.toContain(href);
  });

  it("retries a dropped body and keeps the address out of the error", async () => {
    const dropped = vi.fn(async () => {
      throw new Error("connect https://didapi.runexis.ru/api/v1/numbers/showcase");
    });
    const droppedPage = await runexisShowcase("tok", 1, { fetchImpl: dropped });
    expect(dropped).toHaveBeenCalledTimes(2);
    expect(droppedPage.ok).toBe(false);
    if (!droppedPage.ok) {
      expect(droppedPage.meta).toMatchObject({ status: 0, attempts: 2 });
      expect(droppedPage.error).toContain("HTTP 0");
      expect(droppedPage.error).toContain("попыток 2");
      expect(droppedPage.error).not.toContain("didapi");
      expect(droppedPage.error).not.toContain("://");
    }
    expect(JSON.stringify(info.mock.calls)).not.toContain("didapi");

    const broken = vi.fn(async () => {
      const body = new ReadableStream({
        pull() {
          throw new Error("https://didapi.runexis.ru/secret");
        },
      });
      return new Response(body, { status: 200 });
    });
    const brokenPage = await runexisShowcase("tok", 1, { fetchImpl: broken });
    expect(broken).toHaveBeenCalledTimes(2);
    expect(brokenPage.ok).toBe(false);
    if (!brokenPage.ok) {
      expect(brokenPage.meta.status).toBe(200);
      expect(brokenPage.meta.attempts).toBe(2);
      expect(brokenPage.error).toContain("Площадка не ответила.");
      expect(brokenPage.error).toContain("HTTP 200");
      expect(brokenPage.error).not.toContain("didapi");
      expect(brokenPage.error).not.toContain("://");
    }
  });

  it("refreshes once after 401 and does not refresh after 403", async () => {
    const session = { token: "old", refreshToken: "refresh-secret" };
    const calls: { href: string; method: string; body: string }[] = [];
    const beats: number[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const href = String(input);
      calls.push({ href, method: init?.method ?? "", body: String(init?.body ?? "") });
      if (href.endsWith("/refresh")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { token: "new", refresh_token: "next" },
          }),
          { status: 200 },
        );
      }
      if (href.includes("/management")) {
        return new Response("no", { status: 403 });
      }
      if (calls.filter((call) => call.href.includes("/showcase")).length === 1) {
        return new Response("no", { status: 401 });
      }
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer new");
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          meta: { total: 0, page: 1, limit: 30 },
        }),
        { status: 200 },
      );
    };
    const page = await runexisRead(session, "showcase", 1, {
      fetchImpl,
      beat: async () => {
        beats.push(1);
      },
    });
    expect(page.ok).toBe(true);
    expect(session).toEqual({ token: "new", refreshToken: "next" });
    expect(beats).toEqual([1, 1]);
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "GET"]);
    expect(JSON.parse(calls[1]?.body ?? "")).toEqual({ token: "refresh-secret" });
    expect(JSON.stringify(info.mock.calls)).not.toContain("refresh-secret");
    expect(JSON.stringify(info.mock.calls)).not.toContain("new");

    calls.length = 0;
    const forbidden = await runexisRead(
      { token: "old", refreshToken: "refresh-secret" },
      "management",
      1,
      { fetchImpl },
    );
    expect(forbidden.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
  });
});
