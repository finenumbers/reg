import { describe, expect, it } from "vitest";
import {
  moneyText,
  parseCountries,
  parseFreePage,
  parseFreeTotal,
  parsePurchasedPage,
  parsePurchasedTotal,
  russianCountries,
} from "@/modules/mcn/parse";

const DID = "74951234567";

describe("MCN Telecom pages", () => {
  it("keeps a readable price and leaves a bad price empty", () => {
    expect(moneyText(0)).toBe("0");
    expect(moneyText(1.5)).toBe("1.5");
    expect(moneyText(1.2345)).toBe("1.2345");
    expect(moneyText(1.23456)).toBe("");
    expect(moneyText(1e21)).toBe("");
    expect(moneyText(-1)).toBe("");
    expect(moneyText("1e2")).toBe("");
    expect(moneyText(null)).toBe("");
  });

  it("reads a free number and its tariff prices", () => {
    const page = parseFreePage(
      {
        totalNumbers: 2,
        numbers: [
          {
            number: `+${DID}`,
            default_tariff: { price_setup: 100, price_per_period: 10 },
          },
          { number: "89991234567" },
        ],
      },
      25,
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.rows[0]).toEqual({
      e164: DID,
      incomingPurchase: "100",
      incomingPeriod: "10",
    });
    expect(page.rows[1]?.e164).toBe("89991234567");
    expect(page.rows[1]?.incomingPurchase).toBe("");
    expect(page.rows[1]?.incomingPeriod).toBe("");
  });

  it("fails a free page that repeats a number or exceeds the limit", () => {
    expect(
      parseFreePage({ totalNumbers: 2, numbers: [{ number: DID }, { number: DID }] }, 25)
        .ok,
    ).toBe(false);
    const long = Array.from({ length: 26 }, (_, index) => ({
      number: `7495123${String(index).padStart(4, "0")}`,
    }));
    expect(parseFreePage({ totalNumbers: 26, numbers: long }, 25).ok).toBe(false);
  });

  it("reads a purchased page and rejects a mismatched offset", () => {
    const page = parsePurchasedPage(
      { data: [{ did: DID }], offset: 0, totalCount: 1 },
      100,
      0,
    );
    expect(page.ok).toBe(true);
    if (page.ok) expect(page.rows).toEqual([DID]);
    expect(
      parsePurchasedPage({ data: [{ did: null }], offset: 0, totalCount: 1 }, 100, 0).ok,
    ).toBe(false);
    expect(
      parsePurchasedPage({ data: [{ did: DID }], offset: 5, totalCount: 1 }, 100, 0).ok,
    ).toBe(false);
    expect(
      parsePurchasedTotal({ offset: 0, totalCount: 4, data: [{ did: null }] }, 0),
    ).toEqual({
      ok: true,
      total: 4,
    });
    expect(parseFreeTotal({ totalNumbers: 0, numbers: null })).toEqual({
      ok: true,
      total: 0,
    });
  });

  it("fails the directory when a country is unreadable and keeps only prefix 7", () => {
    expect(
      parseCountries({ countries: [{ country_code: 1.5, country_prefix: 7 }] }).ok,
    ).toBe(false);
    expect(
      parseCountries({
        countries: [
          { country_code: 643, country_prefix: 7 },
          { country_code: 643, country_prefix: 7 },
        ],
      }).ok,
    ).toBe(false);
    const parsed = parseCountries({
      countries: [
        { country_code: 1, country_prefix: 1 },
        { country_code: 643, country_prefix: 7 },
        { country_code: 380, country_prefix: 380 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(russianCountries(parsed.countries)).toEqual([643]);
    expect(parsed.countries).toHaveLength(3);
  });
});
