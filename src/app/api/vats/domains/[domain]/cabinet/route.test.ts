import { beforeEach, describe, expect, it, vi } from "vitest";

const requireVatsUser = vi.fn();
const openDomainCabinet = vi.fn();

vi.mock("@/modules/vats/http", () => ({
  requireVatsUser: (...args: unknown[]) => requireVatsUser(...args),
}));

vi.mock("@/modules/vats/service", () => ({
  openDomainCabinet: (...args: unknown[]) => openDomainCabinet(...args),
}));

vi.mock("@/lib/request-ip", () => ({
  getRequestIp: async () => "203.0.113.5",
}));

import { GET } from "@/app/api/vats/domains/[domain]/cabinet/route";

const context = { params: Promise.resolve({ domain: "domain.pbx.com" }) };

function navigate(extra: Record<string, string> = {}): Request {
  return new Request("https://app.example/api/vats/domains/domain.pbx.com/cabinet", {
    headers: {
      host: "app.example",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      "sec-fetch-site": "same-origin",
      ...extra,
    },
  });
}

describe("GET /api/vats/domains/[domain]/cabinet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not open a cabinet for a prefetch", async () => {
    const response = await GET(navigate({ purpose: "prefetch" }), context);
    expect(response.status).toBe(400);
    expect(requireVatsUser).not.toHaveBeenCalled();
    expect(openDomainCabinet).not.toHaveBeenCalled();
    const text = await response.text();
    expect(text).toContain("Откройте кабинет из списка доменов.");
    expect(text).not.toContain("domain.pbx.com");
  });

  it("redirects a navigation and does not echo a bad link", async () => {
    requireVatsUser.mockResolvedValue({ ok: true, userId: "admin" });
    openDomainCabinet.mockResolvedValueOnce({
      ok: true,
      location: "https://domain.pbx.com/api/login?session=a+b%2Fc",
    });
    const response = await GET(navigate(), context);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://domain.pbx.com/api/login?session=a+b%2Fc",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).toBe("");
    expect(openDomainCabinet).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "domain.pbx.com",
        userId: "admin",
        ip: "203.0.113.5",
      }),
    );
    const hosts = openDomainCabinet.mock.calls[0]?.[0].appHosts as Set<string>;
    expect(hosts.has("app.example")).toBe(true);

    openDomainCabinet.mockResolvedValueOnce({
      ok: false,
      status: 502,
      error: "see https://secret.example/session",
    });
    const failed = await GET(navigate(), context);
    expect(failed.status).toBe(502);
    const text = await failed.text();
    expect(text).toContain("Не удалось открыть кабинет домена.");
    expect(text).not.toContain("secret.example");
    expect(text).not.toContain("domain.pbx.com");
  });
});
