import { beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.fn();

vi.mock("@/lib/logger", () => ({
  logger: { info: (...args: unknown[]) => info(...args), warn: vi.fn(), error: vi.fn() },
}));

import { runexisLogin, runexisShowcase } from "@/modules/runexis/client";

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
});
