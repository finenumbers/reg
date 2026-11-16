import { describe, expect, it } from "vitest";
import { createMcnClient, type Transport } from "@/modules/mcn/client";
import {
  authorizationHeader,
  countriesUrl,
  freePageTooFar,
  freeUrl,
  offsetTooFar,
  platformRequest,
  purchasedUrl,
} from "@/modules/mcn/url";

const TOKEN = "mcn-test-key";

function json(status: number, body: unknown) {
  return { status, body: JSON.stringify(body) };
}

describe("MCN Telecom client", () => {
  it("builds the three reads and no other query", () => {
    const purchased = purchasedUrl(0, 100);
    expect(purchased).not.toBeNull();
    const purchasedTarget = new URL(purchased ?? "");
    expect(purchasedTarget.hostname).toBe("vpbx.mcn.ru");
    expect(purchasedTarget.pathname).toBe("/api/protected/phone/composite-dids");
    expect([...purchasedTarget.searchParams.keys()]).toEqual(["limit", "offset", "type"]);
    expect(purchasedTarget.searchParams.get("type")).toBe("common");
    expect(purchasedTarget.searchParams.get("limit")).toBe("100");
    expect(purchased).not.toContain(TOKEN);

    const countries = new URL(countriesUrl());
    expect(countries.hostname).toBe("shop.mcn.ru");
    expect(countries.pathname).toBe("/api/protected/showcase/countries");
    expect(countries.search).toBe("");

    const free = freeUrl(643, 1);
    const freeTarget = new URL(free ?? "");
    expect([...freeTarget.searchParams.keys()]).toEqual([
      "countryCode",
      "limitPerPage",
      "pageNumber",
    ]);
    expect(freeTarget.searchParams.get("limitPerPage")).toBe("25");
    expect(platformRequest(purchased ?? "")?.method).toBe("GET");
    expect(platformRequest("https://shop.mcn.ru/api/protected/checkout")).toBeNull();
    expect(
      platformRequest("https://evil.example/api/protected/showcase/numbers"),
    ).toBeNull();
    expect(
      platformRequest("https://user:pass@shop.mcn.ru/api/protected/showcase/countries"),
    ).toBe(null);
    expect(authorizationHeader(TOKEN)).toBe(`Bearer ${TOKEN}`);
    expect(offsetTooFar(5_000_001)).toBe(true);
    expect(offsetTooFar(5_000_000)).toBe(false);
    expect(freePageTooFar(200_002)).toBe(true);
    expect(freePageTooFar(200_001)).toBe(false);
  });

  it("does not send a broken token and does not retry a rejection", async () => {
    let calls = 0;
    const transport: Transport = async (url, token) => {
      calls += 1;
      expect(url).not.toContain(token);
      expect(token).toBe(TOKEN);
      return { status: 401, body: "{}" };
    };
    const broken = createMcnClient("bad\ntoken", { transport });
    const blocked = await broken.purchased(0, 1);
    expect(blocked.ok).toBe(false);
    expect(calls).toBe(0);

    const client = createMcnClient(TOKEN, { transport });
    const rejected = await client.purchased(0, 1);
    expect(rejected.ok).toBe(false);
    expect(rejected.meta.attempts).toBe(1);

    let redirectCalls = 0;
    const redirect: Transport = async () => {
      redirectCalls += 1;
      return { status: 302, body: "" };
    };
    const redirected = await createMcnClient(TOKEN, { transport: redirect }).countries();
    expect(redirected.ok).toBe(false);
    expect(redirectCalls).toBe(1);
  });

  it("retries a transport failure once and keeps the rows of a successful page", async () => {
    let calls = 0;
    const transport: Transport = async () => {
      calls += 1;
      if (calls === 1) return { status: 500, body: "" };
      return json(200, {
        data: [{ did: "74951234567" }],
        offset: 0,
        totalCount: 1,
      });
    };
    const page = await createMcnClient(TOKEN, { transport }).purchased(0, 1);
    expect(calls).toBe(2);
    expect(page.ok).toBe(true);
    if (page.ok) expect(page.rows).toEqual(["74951234567"]);

    let big = 0;
    const oversized: Transport = async () => {
      big += 1;
      return { status: 200, body: "", tooBig: true };
    };
    const huge = await createMcnClient(TOKEN, { transport: oversized }).countries();
    expect(huge.ok).toBe(false);
    expect(big).toBe(1);
  });
});
