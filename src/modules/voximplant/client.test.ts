import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseCredentials, signJwt, TokenCache } from "@/modules/voximplant/auth";
import { createVoximplantClient, type Transport } from "@/modules/voximplant/client";
import { STATES_REQUIRED } from "@/modules/voximplant/parse";
import {
  categoriesUrl,
  freeUrl,
  platformRequest,
  purchasedUrl,
  regionsUrl,
} from "@/modules/voximplant/url";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function credentials(privateKeyText = pem) {
  return JSON.stringify({
    account_id: 42,
    key_id: "key-1",
    private_key: privateKeyText,
    account_email: "ops@example.com",
  });
}

describe("Voximplant credentials", () => {
  it("signs iss as a number and puts iat ten seconds in the past", () => {
    const creds = parseCredentials(credentials());
    expect(creds?.accountId).toBe(42);
    expect(creds?.blob).toContain("account_email");
    if (!creds) return;
    const now = 1_700_000_000;
    const token = signJwt(creds, now);
    const [headerPart, payloadPart, signaturePart] = token.split(".");
    const header = JSON.parse(Buffer.from(headerPart ?? "", "base64url").toString()) as {
      typ: string;
      alg: string;
      kid: string;
    };
    const payload = JSON.parse(
      Buffer.from(payloadPart ?? "", "base64url").toString(),
    ) as {
      iat: number;
      iss: number;
      exp: number;
    };
    expect(header).toEqual({ typ: "JWT", alg: "RS256", kid: "key-1" });
    expect(typeof payload.iss).toBe("number");
    expect(payload.iss).toBe(42);
    expect(payload.iat).toBe(now - 10);
    expect(payload.exp).toBe(payload.iat + 3600);
    const body = `${headerPart}.${payloadPart}`;
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(body),
        publicKey,
        Buffer.from(signaturePart ?? "", "base64url"),
      ),
    ).toBe(true);
    const cache = new TokenCache();
    expect(cache.sign(creds, now)).toBe(cache.sign(creds, now + 1000));
    expect(cache.sign(creds, now + 3600)).not.toBe(token);
  });

  it("accepts a PEM whose newlines were escaped twice and rejects a key that is not RSA", () => {
    const escaped = pem.replaceAll("\n", "\\n");
    expect(parseCredentials(credentials(escaped))?.accountId).toBe(42);
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const ecPem = ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(parseCredentials(credentials(ecPem))).toBeNull();
    expect(
      parseCredentials('{"account_id":"42","key_id":"key-1","private_key":"x"}'),
    ).toBeNull();
  });
});

describe("Voximplant requests", () => {
  it("builds only the four read methods", () => {
    const purchased = new URL(purchasedUrl(20, 100));
    expect(purchased.origin).toBe("https://api.voximplant.com");
    expect(purchased.pathname).toBe("/platform_api/GetPhoneNumbers");
    expect(purchased.searchParams.get("count")).toBe("100");
    expect(purchased.searchParams.get("offset")).toBe("20");
    expect(purchased.searchParams.get("sandbox")).toBe("false");
    expect(purchased.searchParams.get("order_by")).toBe("phone_number");
    expect(purchased.searchParams.has("country_code")).toBe(false);

    const categories = new URL(categoriesUrl());
    expect(categories.pathname).toBe("/platform_api/GetPhoneNumberCategories");
    expect(categories.searchParams.get("country_code")).toBe("RU");
    expect(categories.searchParams.get("sandbox")).toBe("false");
    expect(categories.searchParams.get("locale")).toBe("RU");

    const regions = new URL(regionsUrl("GEOGRAPHIC") ?? "");
    expect(regions.pathname).toBe("/platform_api/GetPhoneNumberRegions");
    expect(regions.searchParams.get("omit_empty")).toBe("true");
    expect(regions.searchParams.has("phone_region_id")).toBe(false);
    expect(regionsUrl("Москва")).toBeNull();

    const free = new URL(freeUrl("MOBILE", 15, 50, 50) ?? "");
    expect(free.pathname).toBe("/platform_api/GetNewPhoneNumbers");
    expect(free.searchParams.get("country_code")).toBe("RU");
    expect(free.searchParams.get("phone_category_name")).toBe("MOBILE");
    expect(free.searchParams.get("phone_region_id")).toBe("15");
    expect(free.searchParams.get("count")).toBe("50");
    expect(free.searchParams.get("offset")).toBe("50");
    expect(free.searchParams.has("sandbox")).toBe(false);
    expect(free.searchParams.has("phone_number_mask")).toBe(false);
    expect(free.searchParams.has("order_by")).toBe(false);
    expect(freeUrl("MOBILE", 1.5, 0, 50)).toBeNull();

    const request = platformRequest(purchased.href);
    expect(request).toMatchObject({
      hostname: "api.voximplant.com",
      method: "POST",
      servername: "api.voximplant.com",
    });
    expect(request?.path).not.toContain("Bearer");
    expect(request?.path).not.toContain("private_key");
  });

  it("retries a transport failure once and does not retry a platform error", async () => {
    const creds = parseCredentials(credentials());
    if (!creds) throw new Error("key");
    const calls: string[] = [];
    const transport: Transport = async (url) => {
      calls.push(new URL(url).pathname);
      if (calls.length === 1) return { status: 500, body: "" };
      return {
        status: 200,
        body: JSON.stringify({ result: [], total_count: 0, count: 0 }),
      };
    };
    const client = createVoximplantClient(creds, { transport, now: () => 1_700_000_000 });
    const page = await client.purchased(0, 100);
    expect(page.ok).toBe(true);
    expect(calls).toHaveLength(2);

    let rejectedCalls = 0;
    const rejectedClient = createVoximplantClient(creds, {
      now: () => 1_700_000_000,
      transport: async () => {
        rejectedCalls += 1;
        return { status: 401, body: "" };
      },
    });
    const denied = await rejectedClient.purchased(0, 1);
    expect(rejectedCalls).toBe(1);
    expect(denied.ok).toBe(false);
    expect(calls[0]).toBe("/platform_api/GetPhoneNumbers");
    expect(page.ok && page.meta.attempts).toBe(2);

    let errors = 0;
    const errorTransport: Transport = async (url, token) => {
      errors += 1;
      expect(url).not.toContain(token);
      expect(token.startsWith("eyJ")).toBe(true);
      return {
        status: 200,
        body: JSON.stringify({
          error: { code: 314, msg: "CONCURRENT_RESOURCE_LIMIT_EXCEEDED" },
        }),
      };
    };
    const failing = createVoximplantClient(creds, {
      transport: errorTransport,
      now: () => 1_700_000_000,
    });
    const rejected = await failing.categories();
    expect(errors).toBe(1);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toBe("CONCURRENT_RESOURCE_LIMIT_EXCEEDED");

    const states = createVoximplantClient(creds, {
      now: () => 1_700_000_000,
      transport: async () => ({
        status: 200,
        body: JSON.stringify({
          result: [
            {
              country_code: "RU",
              can_list_phone_numbers: true,
              phone_categories: [
                { phone_category_name: "GEOGRAPHIC", country_has_states: true },
              ],
            },
          ],
        }),
      }),
    });
    const directory = await states.categories();
    expect(directory).toMatchObject({ ok: false, error: STATES_REQUIRED });
  });

  it("does not call the platform for a category name it will not send", async () => {
    const creds = parseCredentials(credentials());
    if (!creds) throw new Error("key");
    let calls = 0;
    const client = createVoximplantClient(creds, {
      now: () => 1_700_000_000,
      transport: async () => {
        calls += 1;
        return { status: 200, body: "{}" };
      },
    });
    const regions = await client.regions("bad name");
    expect(regions.ok).toBe(false);
    expect(calls).toBe(0);
  });
});
