import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import { sipoutGet } from "@/modules/sipout/client";

const KEY = "super-secret-key";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sipout client", () => {
  it("does not put the key into the error or the log", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => {
      throw new Error(`boom https://lk.sipout.net/userapi/?key=${KEY}`);
    });
    const result = await sipoutGet(KEY, { action: "get_cities" }, { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain(KEY);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(info.mock.calls)).not.toContain(KEY);
  });

  it("retries a 5xx once and does not retry a rejected result", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("no", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: "ok", data: { cities: [] } }), {
          status: 200,
        }),
      );
    const retried = await sipoutGet(KEY, { action: "get_cities" }, { fetchImpl });
    expect(retried).toEqual({ ok: true, data: { cities: [] } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const rejected = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ result: "bad", err: "auth", err_text: `key=${KEY} denied` }),
          { status: 200 },
        ),
    );
    const bad = await sipoutGet(
      KEY,
      { action: "connected_list" },
      { fetchImpl: rejected },
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).not.toContain(KEY);
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it("does not follow a body over the cap", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("[]", { status: 200, headers: { "content-length": "999999999" } }),
    );
    const result = await sipoutGet(KEY, { action: "get_cities" }, { fetchImpl });
    expect(result).toEqual({ ok: false, error: "Ответ площадки слишком большой." });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
