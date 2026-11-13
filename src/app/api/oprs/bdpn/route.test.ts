import { beforeEach, describe, expect, it, vi } from "vitest";
import { bdpnLookupRateLimiter } from "@/lib/rate-limit";
import { resetBdpnFlight } from "@/modules/bdpn/flight";
import { BdpnLookupError } from "@/modules/bdpn/parse";

const requireApiPermission = vi.fn();
const assertSameOrigin = vi.fn();
const lookupBdpnNumber = vi.fn();

vi.mock("@/modules/auth/guards", () => ({
  requireApiPermission: (...args: unknown[]) => requireApiPermission(...args),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (...args: unknown[]) => assertSameOrigin(...args),
}));

vi.mock("@/modules/bdpn/client", () => ({
  lookupBdpnNumber: (...args: unknown[]) => lookupBdpnNumber(...args),
}));

import { POST } from "@/app/api/oprs/bdpn/route";

const sessionGate = {
  ok: true as const,
  ctx: { authKind: "session" as const, session: { user: { id: "user-1" } } },
};

const keyGate = {
  ok: true as const,
  ctx: { authKind: "api_key" as const },
};

const csrfDenied = {
  ok: false as const,
  response: new Response(JSON.stringify({ code: "CSRF_ORIGIN" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  }),
};

function request(number: unknown): Request {
  return new Request("http://localhost/api/oprs/bdpn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ number, extra: "ignored" }),
  });
}

describe("POST /api/oprs/bdpn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBdpnFlight();
    bdpnLookupRateLimiter.reset();
    assertSameOrigin.mockReturnValue({ ok: true });
    requireApiPermission.mockResolvedValue(sessionGate);
    lookupBdpnNumber.mockResolvedValue({
      found: true,
      number: "9030768600",
      operator: '"ВымпелКом" ПАО',
      territory: "Новосибирская область",
      inn: "7713076301",
    });
  });

  it("refuses a foreign origin and an API key before any lookup", async () => {
    assertSameOrigin.mockReturnValueOnce(csrfDenied);
    const origin = await POST(request("79030768600"));
    expect(origin.status).toBe(403);
    expect(lookupBdpnNumber).not.toHaveBeenCalled();

    requireApiPermission.mockResolvedValue(keyGate);
    const key = await POST(request("79030768600"));
    expect(key.status).toBe(403);
    expect(lookupBdpnNumber).not.toHaveBeenCalled();
  });

  it("rejects a number that is not mobile RF without calling the form", async () => {
    const response = await POST(request("74951234567"));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID" });
    expect(lookupBdpnNumber).not.toHaveBeenCalled();
  });

  it("checks the ten digits after the leading 7", async () => {
    const response = await POST(request("79030768600"));
    expect(response.status).toBe(200);
    expect(lookupBdpnNumber).toHaveBeenCalledTimes(1);
    expect(lookupBdpnNumber.mock.calls[0]?.[0]).toBe("9030768600");
    await expect(response.json()).resolves.toEqual({
      found: true,
      number: "9030768600",
      operator: '"ВымпелКом" ПАО',
      territory: "Новосибирская область",
      inn: "7713076301",
    });
  });

  it("returns 502 when the form fails", async () => {
    lookupBdpnNumber.mockRejectedValueOnce(
      new BdpnLookupError("TIMEOUT", "БДПН: сервис не ответил вовремя."),
    );
    const response = await POST(request("79030768600"));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: "TIMEOUT",
      error: "БДПН: сервис не ответил вовремя.",
    });
  });

  it("stops a second check for the same user and a third check in the process", async () => {
    let releaseFirst: (() => void) | undefined;
    lookupBdpnNumber.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () =>
            resolve({
              found: false,
              number: "9030768600",
            });
        }),
    );
    const first = POST(request("79030768600"));
    await vi.waitFor(() => expect(lookupBdpnNumber).toHaveBeenCalledTimes(1));

    const second = await POST(request("79030768601"));
    expect(second.status).toBe(429);
    expect(lookupBdpnNumber).toHaveBeenCalledTimes(1);

    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "session", session: { user: { id: "user-2" } } },
    });
    let releaseSecond: (() => void) | undefined;
    lookupBdpnNumber.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSecond = () => resolve({ found: false, number: "9030768601" });
        }),
    );
    const other = POST(request("79030768601"));
    await vi.waitFor(() => expect(lookupBdpnNumber).toHaveBeenCalledTimes(2));

    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "session", session: { user: { id: "user-3" } } },
    });
    const third = await POST(request("79030768602"));
    expect(third.status).toBe(429);
    expect(lookupBdpnNumber).toHaveBeenCalledTimes(2);

    releaseFirst?.();
    releaseSecond?.();
    await first;
    await other;
  });

  it("returns 429 after thirty checks in a minute", async () => {
    for (let i = 0; i < 30; i += 1) {
      bdpnLookupRateLimiter.check("bdpn:user-1");
    }
    const response = await POST(request("79030768600"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(lookupBdpnNumber).not.toHaveBeenCalled();
  });
});
