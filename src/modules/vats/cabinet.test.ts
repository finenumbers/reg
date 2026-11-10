import { afterEach, describe, expect, it, vi } from "vitest";
import { SlidingWindowRateLimiter } from "@/lib/rate-limit";
import {
  CABINET_LIMIT,
  CABINET_LINK_ERROR,
  CABINET_MISSING,
  cabinetAppHosts,
  cabinetAuditMeta,
  cabinetErrorText,
  cabinetLocation,
  cabinetNavigation,
  runCabinetOpen,
  type CabinetIo,
} from "@/modules/vats/cabinet";
import type { BossAuth } from "@/modules/vats/client";

const auth: BossAuth = {
  origin: "https://platform.example",
  login: "boss-user",
  password: "pw-secret",
};

const link = "https://domain.pbx.com/api/login?session=a+b%2Fc";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

function io(overrides: Partial<CabinetIo> = {}): CabinetIo {
  return {
    creds: async () => ({ ok: true, auth }),
    member: async () => true,
    allow: () => true,
    read: async () => ({
      ok: true,
      status: 200,
      data: { link, accessURL: "https://nope" },
    }),
    audit: async () => undefined,
    ...overrides,
  };
}

const input = {
  domain: "domain.pbx.com",
  userId: "admin",
  ip: null,
  appHosts: new Set<string>(),
};

describe("cabinet navigation", () => {
  it("accepts a document navigation and refuses prefetch, fetch, and another site", () => {
    expect(
      cabinetNavigation(
        headers({
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(true);
    expect(
      cabinetNavigation(
        headers({
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
          "sec-fetch-site": "none",
        }),
      ),
    ).toBe(true);
    expect(
      cabinetNavigation(
        headers({
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
          "sec-fetch-site": "same-origin",
          purpose: "prefetch",
        }),
      ),
    ).toBe(false);
    expect(
      cabinetNavigation(
        headers({
          "sec-fetch-mode": "cors",
          "sec-fetch-dest": "empty",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(false);
    expect(
      cabinetNavigation(
        headers({
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
          "sec-fetch-site": "same-site",
        }),
      ),
    ).toBe(false);
    expect(cabinetNavigation(headers({}))).toBe(false);
  });
});

describe("cabinet link", () => {
  it("keeps the token and ignores every other field", () => {
    expect(
      cabinetLocation({ link, accessURL: "https://secret.example" }, new Set()),
    ).toBe(link);
  });

  it("refuses a link that is not a public https cabinet", () => {
    const hosts = new Set(["app.example"]);
    expect(
      cabinetLocation({ link: "http://domain.pbx.com/api/login" }, hosts),
    ).toBeNull();
    expect(
      cabinetLocation({ link: "https://user:pass@domain.pbx.com/api/login" }, hosts),
    ).toBeNull();
    expect(cabinetLocation({ link: "https://localhost/api/login" }, hosts)).toBeNull();
    expect(
      cabinetLocation({ link: "https://pbx.localhost/api/login" }, hosts),
    ).toBeNull();
    expect(
      cabinetLocation({ link: "https://printer.local/api/login" }, hosts),
    ).toBeNull();
    expect(cabinetLocation({ link: "https://127.0.0.1/api/login" }, hosts)).toBeNull();
    expect(cabinetLocation({ link: "https://[::1]/api/login" }, hosts)).toBeNull();
    expect(
      cabinetLocation({ link: "https://domain.pbx.com/api/login\n" }, hosts),
    ).toBeNull();
    expect(
      cabinetLocation({ link: "https://domain.pbx.com/api login" }, hosts),
    ).toBeNull();
    expect(cabinetLocation({ link: "/api/login" }, hosts)).toBeNull();
    expect(
      cabinetLocation({ link: "https://app.example/api/login?session=1" }, hosts),
    ).toBeNull();
    expect(cabinetLocation({ accessURL: link }, hosts)).toBeNull();
    expect(cabinetLocation(link, hosts)).toBeNull();
  });

  it("collects this app's hosts", () => {
    const previous = process.env.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_URL = "https://reg.example";
    try {
      const found = cabinetAppHosts(
        new Request("https://edge.example/api/vats/domains/a/cabinet", {
          headers: { host: "edge.example" },
        }),
      );
      expect(found.has("edge.example")).toBe(true);
      expect(found.has("reg.example")).toBe(true);
    } finally {
      if (previous == null) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = previous;
    }
  });
});

describe("cabinet open", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not read Boss when the domain is not in the snapshot", async () => {
    const allow = vi.fn(() => true);
    const read = vi.fn();
    const result = await runCabinetOpen(
      input,
      io({ member: async () => false, allow, read }),
    );
    expect(result).toEqual({ ok: false, status: 404, error: CABINET_MISSING });
    expect(allow).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not take the lock on the twenty-first Boss call", async () => {
    const limiter = new SlidingWindowRateLimiter(20, 60_000);
    const read = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: { link },
    }));
    const bound = io({
      allow: (userId) => limiter.check(userId).allowed,
      read,
    });
    for (let n = 0; n < 20; n += 1) {
      const result = await runCabinetOpen(input, bound);
      expect(result).toEqual({ ok: true, location: link });
    }
    const blocked = await runCabinetOpen(input, bound);
    expect(blocked).toEqual({ ok: false, status: 429, error: CABINET_LIMIT });
    expect(read).toHaveBeenCalledTimes(20);
  });

  it("returns a platform failure without the link and still redirects when audit fails", async () => {
    const denied = await runCabinetOpen(
      input,
      io({
        read: async () => ({
          ok: false,
          status: 401,
          error: "Данные для авторизации не приняты.",
          retry: false,
        }),
      }),
    );
    expect(denied).toEqual({
      ok: false,
      status: 502,
      error: "Данные для авторизации не приняты.",
    });
    expect(JSON.stringify(denied)).not.toContain("https");

    const audited = vi.fn(async () => {
      throw new Error("db down");
    });
    const opened = await runCabinetOpen(input, io({ audit: audited }));
    expect(opened).toEqual({ ok: true, location: link });
    expect(audited).toHaveBeenCalledWith("domain.pbx.com", {
      userId: "admin",
      ip: null,
    });
  });

  it("does not audit a link this app must not send", async () => {
    const audit = vi.fn();
    const result = await runCabinetOpen(
      { ...input, appHosts: new Set(["app.example"]) },
      io({
        audit,
        read: async () => ({
          ok: true,
          status: 200,
          data: { link: "https://app.example/api/login?session=abc" },
        }),
      }),
    );
    expect(result).toEqual({ ok: false, status: 502, error: CABINET_LINK_ERROR });
    expect(JSON.stringify(result)).not.toContain("session=abc");
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("cabinet audit", () => {
  it("records the domain and nothing else", () => {
    const meta = cabinetAuditMeta("domain.pbx.com");
    expect(meta).toEqual({ domain: "domain.pbx.com" });
    expect(Object.keys(meta)).not.toContain("link");
    expect(JSON.stringify(meta)).not.toContain("https");
    expect(cabinetErrorText("see https://secret", "domain.pbx.com")).toBe(
      "Не удалось открыть кабинет домена.",
    );
    expect(cabinetErrorText("Домен не найден.", "domain.pbx.com")).toBe(
      "Домен не найден.",
    );
  });
});
