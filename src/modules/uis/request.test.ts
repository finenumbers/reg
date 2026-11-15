import { describe, expect, it } from "vitest";
import { parseRpc, uisDigits } from "@/modules/uis/parse";
import { planSlices, SUM_MISMATCH } from "@/modules/uis/partition";
import {
  ACCESS_LIMIT,
  OFFSET_MAX,
  PAGE_LIMIT,
  WINDOW,
  buildRequest,
  pageOffsets,
} from "@/modules/uis/url";

const TOKEN = "uis-secret-key";

function body(list: "purchased" | "free", call: Parameters<typeof buildRequest>[2]) {
  const text = buildRequest(TOKEN, list, call, 7);
  expect(text).not.toBeNull();
  return JSON.parse(text ?? "") as {
    method: string;
    params: Record<string, unknown>;
  };
}

describe("UIS request", () => {
  it("sends the two get methods and never a user id", () => {
    const purchased = body("purchased", { purpose: "access" });
    const free = body("free", { purpose: "read", filter: { kind: "all" }, offset: 0 });
    expect(purchased.method).toBe("get.virtual_numbers");
    expect(free.method).toBe("get.available_virtual_numbers");
    expect(purchased.params).not.toHaveProperty("user_id");
    expect(free.params).not.toHaveProperty("user_id");
    expect(purchased.params.fields).toEqual(["virtual_phone_number"]);
    expect(free.params.fields).toEqual([
      "phone_number",
      "onetime_payment",
      "monthly_charge",
    ]);
    expect(purchased.params).not.toHaveProperty("sort");
    expect(free.params.sort).toEqual([{ field: "phone_number", order: "asc" }]);
    expect(purchased.params.limit).toBe(ACCESS_LIMIT);
    expect(free.params.limit).toBe(PAGE_LIMIT);
    expect(purchased.params).not.toHaveProperty("filter");
  });

  it("builds a filter only from the prefix split", () => {
    const like = body("purchased", {
      purpose: "count",
      filter: { kind: "like", prefix: "7495" },
    });
    const exact = body("free", {
      purpose: "count",
      filter: { kind: "eq", prefix: "7495" },
    });
    const rest = body("free", {
      purpose: "count",
      filter: { kind: "regexp", prefix: "7495" },
    });
    const root = body("purchased", {
      purpose: "count",
      filter: { kind: "regexp", prefix: "" },
    });
    expect(like.params.filter).toEqual({
      field: "virtual_phone_number",
      operator: "like",
      value: "7495%",
    });
    expect(exact.params.filter).toEqual({
      field: "phone_number",
      operator: "=",
      value: "7495",
    });
    expect(rest.params.filter).toEqual({
      field: "phone_number",
      operator: "regexp",
      value: "^7495[^0-9]",
    });
    expect(root.params.filter).toEqual({
      field: "virtual_phone_number",
      operator: "regexp",
      value: "^[^0-9]",
    });
    expect(like.params).not.toHaveProperty("sort");
    expect(exact.params).not.toHaveProperty("sort");
    expect(buildRequest(TOKEN, "free", { purpose: "probe" }, 1)).toContain(
      '"value":"0%"',
    );
    expect(
      buildRequest(
        TOKEN,
        "purchased",
        { purpose: "read", filter: { kind: "all" }, offset: 110_000 },
        1,
      ),
    ).toBeNull();
    expect(
      buildRequest(
        TOKEN,
        "free",
        { purpose: "read", filter: { kind: "all" }, offset: 100_000 },
        1,
      ),
    ).not.toBeNull();
  });

  it("never offers an offset past 100000", () => {
    expect(WINDOW).toBe(OFFSET_MAX + PAGE_LIMIT);
    expect(pageOffsets(WINDOW)).toEqual([
      0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000,
    ]);
    expect(pageOffsets(WINDOW + 1)).toBeNull();
    expect(pageOffsets(0)).toEqual([]);
  });

  it("keeps an 8 and rejects a formatted number", () => {
    expect(uisDigits("84951234567")).toBe("84951234567");
    expect(uisDigits("+74951234567")).toBe("74951234567");
    expect(uisDigits("8 (495) 123-45-67")).toBeNull();
    expect(uisDigits(74951234567)).toBe("74951234567");
  });

  it("treats an HTTP 200 error object as a failure and hides the echoed key", () => {
    const parsed = parseRpc(
      {
        jsonrpc: "2.0",
        id: 7,
        error: {
          message: "Площадка отклонила поле",
          data: {
            mnemonic: "invalid_parameter_value",
            value: TOKEN,
            params: { access_token: TOKEN },
          },
        },
      },
      7,
      TOKEN,
      "purchased",
      "read",
      ACCESS_LIMIT,
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("invalid_parameter_value");
      expect(parsed.error).toContain("Площадка отклонила поле");
      expect(parsed.error).not.toContain(TOKEN);
      expect(parsed.error).not.toContain("access_token");
    }
  });

  it("fails a page that repeats a number and keeps a bad price empty", () => {
    const duplicate = parseRpc(
      {
        jsonrpc: "2.0",
        id: "4",
        result: {
          metadata: { total_items: 2 },
          data: [{ phone_number: "74951234567" }, { phone_number: "+74951234567" }],
        },
      },
      4,
      TOKEN,
      "free",
      "read",
      PAGE_LIMIT,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error).toBe("В ответе повторяется номер.");

    const priced = parseRpc(
      {
        jsonrpc: "2.0",
        id: 4,
        result: {
          metadata: { total_items: 1, limits: { day_remaining: 1, minute_remaining: 1 } },
          data: [
            {
              phone_number: "74951234567",
              onetime_payment: 1.5,
              monthly_charge: "1e3",
            },
          ],
        },
      },
      4,
      TOKEN,
      "free",
      "read",
      PAGE_LIMIT,
    );
    expect(priced.ok).toBe(true);
    if (priced.ok) {
      expect(priced.rows).toEqual([
        { e164: "74951234567", incomingPurchase: "1.5", incomingPeriod: "" },
      ]);
    }
  });

  it("does not publish when prefix totals do not add up", async () => {
    const planned = await planSlices(
      WINDOW + 1,
      async (filter) => {
        if (filter.kind === "like" && filter.prefix === "1")
          return { ok: true, total: 1 };
        return { ok: true, total: 0 };
      },
      async () => null,
    );
    expect(planned).toEqual({ ok: false, error: SUM_MISMATCH });
  });
});
