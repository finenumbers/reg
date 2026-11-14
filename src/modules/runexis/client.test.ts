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
});
