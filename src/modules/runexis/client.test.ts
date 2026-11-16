import { beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.fn();

vi.mock("@/lib/logger", () => ({
  logger: { info: (...args: unknown[]) => info(...args), warn: vi.fn(), error: vi.fn() },
}));

import {
  runexisCodes,
  runexisLogin,
  runexisRead,
  runexisShowcaseSlice,
} from "@/modules/runexis/client";

const CODE = { code: "901", cityId: null as number | null };

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

  it("sends one filtered showcase page and retries only a transport or 5xx", async () => {
    const denied = vi.fn(async () => new Response("no", { status: 401 }));
    const deniedPage = await runexisShowcaseSlice(
      { token: "tok", refreshToken: "" },
      1,
      CODE,
      { fetchImpl: denied },
    );
    expect(denied).toHaveBeenCalledTimes(1);
    expect(deniedPage.ok).toBe(false);
    if (!deniedPage.ok) {
      expect(deniedPage.error).toContain("Площадка отклонила доступ.");
      expect(deniedPage.error).toContain("HTTP 401");
      expect(deniedPage.error).toContain("попыток 1");
      expect(deniedPage.error).not.toContain("://");
    }

    const failed = vi.fn(async () => new Response("down", { status: 500 }));
    const failedPage = await runexisShowcaseSlice(
      { token: "tok", refreshToken: "" },
      1,
      CODE,
      { fetchImpl: failed },
    );
    expect(failed).toHaveBeenCalledTimes(2);
    expect(failedPage.ok).toBe(false);
    if (!failedPage.ok) {
      expect(failedPage.error).toContain("Площадка не ответила.");
      expect(failedPage.error).toContain("HTTP 500");
      expect(failedPage.error).not.toContain("down");
    }

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
    const page = await runexisShowcaseSlice({ token: "tok", refreshToken: "" }, 1, CODE, {
      fetchImpl: ok,
    });
    expect(page.ok).toBe(true);
    const url = new URL(href);
    expect([...url.searchParams.keys()].sort()).toEqual([
      "limit",
      "page",
      "region_codes[0]",
    ]);
    expect(url.searchParams.get("region_codes[0]")).toBe("901");
    expect(url.searchParams.has("region_codes[0][0]")).toBe(false);
    expect(url.searchParams.has("region_codes[]")).toBe(false);
    expect(url.searchParams.has("city_ids[]")).toBe(false);
    expect(url.searchParams.has("city_ids[0]")).toBe(false);
    expect(url.searchParams.has("class_id")).toBe(false);
    expect(JSON.stringify(info.mock.calls)).not.toContain("tok");
    expect(JSON.stringify(info.mock.calls)).not.toContain(href);
  });

  it("retries a dropped body and keeps the address out of the error", async () => {
    const dropped = vi.fn(async () => {
      throw new Error("connect https://didapi.runexis.ru/api/v1/numbers/showcase");
    });
    const droppedPage = await runexisShowcaseSlice(
      { token: "tok", refreshToken: "" },
      1,
      CODE,
      { fetchImpl: dropped },
    );
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
    const brokenPage = await runexisShowcaseSlice(
      { token: "tok", refreshToken: "" },
      1,
      CODE,
      { fetchImpl: broken },
    );
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
    const page = await runexisShowcaseSlice(
      session,
      1,
      { code: "495", cityId: 58 },
      {
        fetchImpl,
        beat: async () => {
          beats.push(1);
        },
      },
    );
    expect(page.ok).toBe(true);
    expect(session).toEqual({ token: "new", refreshToken: "next" });
    expect(beats).toEqual([1, 1]);
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "GET"]);
    expect(calls[0]?.href).toContain("region_codes%5B0%5D=495");
    expect(calls[0]?.href).not.toContain("region_codes%5B0%5D%5B0%5D");
    expect(calls[0]?.href).not.toContain("region_codes%5B%5D");
    expect(calls[0]?.href).not.toContain("city_ids");
    expect(calls[2]?.href).toBe(calls[0]?.href);
    expect(calls[0]?.href).not.toContain("class_id");
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

  it("keeps a short platform message from one 400 and does not retry", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: 400,
            message: "  The region codes.0 field must be a string.  ",
            request_id: "abc",
            exception: "hidden",
            errors: { "region_codes.0": ["nope"] },
          }),
          { status: 400 },
        ),
    );
    const page = await runexisShowcaseSlice(
      { token: "tok", refreshToken: "" },
      1,
      { code: "495", cityId: 58 },
      { fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(page.ok).toBe(false);
    if (!page.ok) {
      expect(page.meta).toMatchObject({ status: 400, attempts: 1 });
      expect(page.error).toContain(
        "Площадка отклонила запрос. The region codes.0 field must be a string.",
      );
      expect(page.error).toContain("HTTP 400");
      expect(page.error).toContain("попыток 1");
      expect(page.error).not.toContain("request_id");
      expect(page.error).not.toContain("abc");
      expect(page.error).not.toContain("hidden");
      expect(page.error).not.toContain("nope");
    }
    expect(JSON.stringify(info.mock.calls)).not.toContain("must be a string");
    expect(JSON.stringify(info.mock.calls)).not.toContain("request_id");

    const secretFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "bad token in https://host" }), {
          status: 400,
        }),
    );
    const secret = await runexisShowcaseSlice(
      { token: "tok", refreshToken: "" },
      1,
      CODE,
      {
        fetchImpl: secretFetch,
      },
    );
    expect(secretFetch).toHaveBeenCalledTimes(1);
    expect(secret.ok).toBe(false);
    if (!secret.ok) {
      expect(secret.meta.attempts).toBe(1);
      expect(secret.error).toBe(
        `Площадка отклонила запрос. HTTP ${secret.meta.status}, попыток ${secret.meta.attempts}, ${secret.meta.durationMs} мс.`,
      );
      expect(secret.error).not.toContain("token");
      expect(secret.error).not.toContain("https");
    }

    const broken = vi.fn(async () => {
      const body = new ReadableStream({
        pull() {
          throw new Error("https://didapi.runexis.ru/secret");
        },
      });
      return new Response(body, { status: 400 });
    });
    const brokenPage = await runexisShowcaseSlice(
      { token: "tok", refreshToken: "" },
      1,
      CODE,
      { fetchImpl: broken },
    );
    expect(broken).toHaveBeenCalledTimes(1);
    expect(brokenPage.ok).toBe(false);
    if (!brokenPage.ok) {
      expect(brokenPage.meta).toMatchObject({ status: 400, attempts: 1 });
      expect(brokenPage.error).toContain("Площадка отклонила запрос.");
      expect(brokenPage.error).toContain("HTTP 400");
      expect(brokenPage.error).not.toContain("не ответила");
      expect(brokenPage.error).not.toContain("didapi");
      expect(brokenPage.error).not.toContain("://");
    }
  });

  it("keeps a short platform message from the last 500", async () => {
    const bodies = [
      JSON.stringify({
        message: "first",
        exception: "Illuminate\\Database\\QueryException",
        file: "/var/www/secret.php",
        trace: [{ url: "https://didapi.runexis.ru/secret" }],
      }),
      JSON.stringify({
        success: false,
        message: `  Server Error ${"x".repeat(250)}  `,
        exception: "hidden",
      }),
    ];
    let attempt = 0;
    const fetchImpl: typeof fetch = async () =>
      new Response(bodies[attempt++] ?? "", { status: 500 });
    const page = await runexisShowcaseSlice(
      { token: "tok", refreshToken: "" },
      1,
      { code: "495", cityId: 58 },
      { fetchImpl },
    );
    expect(page.ok).toBe(false);
    if (!page.ok) {
      expect(page.error).toContain("Площадка не ответила. Server Error ");
      expect(page.error).toContain("HTTP 500");
      expect(page.error).toContain("попыток 2");
      expect(page.error).not.toContain("first");
      expect(page.error).not.toContain("Illuminate");
      expect(page.error).not.toContain("secret");
      expect(page.error).not.toContain("://");
      const note = page.error.slice(
        "Площадка не ответила. ".length,
        page.error.indexOf(" HTTP 500"),
      );
      expect(note.length).toBe(200);
    }
    expect(JSON.stringify(info.mock.calls)).not.toContain("Server Error");
    expect(JSON.stringify(info.mock.calls)).not.toContain("secret");

    const secret = await runexisShowcaseSlice(
      { token: "tok", refreshToken: "" },
      1,
      CODE,
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ message: "bad token in https://host" }), {
            status: 503,
          }),
      },
    );
    expect(secret.ok).toBe(false);
    if (!secret.ok) {
      expect(secret.error).toBe(
        `Площадка не ответила. HTTP ${secret.meta.status}, попыток ${secret.meta.attempts}, ${secret.meta.durationMs} мс.`,
      );
      expect(secret.error).not.toContain("token");
      expect(secret.error).not.toContain("https");
    }
  });

  it("reads the code directory with no query", async () => {
    let href = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      href = String(input);
      expect(init?.method).toBe("GET");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer tok");
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    };
    const codes = await runexisCodes({ token: "tok", refreshToken: "" }, { fetchImpl });
    expect(codes.ok).toBe(true);
    expect(href).toBe("https://didapi.runexis.ru/api/v1/regions/codes");
  });
});
