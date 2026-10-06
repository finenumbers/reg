import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";
import {
  EMPTY_CDR_TARIFF,
  elapsedMsToCeiledSeconds,
  omitCdrTariffSecretFilters,
  rateCdrCall,
  stripCdrTariffSecrets,
  type TariffRateLookup,
} from "@/modules/traffic/cdr-tariff";
import { CDR_TARIFF_BATCH_SQL } from "@/modules/traffic/tariff-rate/sql";

const MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261006210000_cdr_tariff_rating/migration.sql",
);

const RATES: TariffRateLookup[] = [
  { direction: "Россия", abc: "7", price: "1", cost: "0.5", sortIndex: 0 },
  { direction: "Москва", abc: "7495", price: "2", cost: "1.2", sortIndex: 1 },
  { direction: "Москва-центр", abc: "74951", price: "3", cost: "1", sortIndex: 2 },
  { direction: "Москва-позже", abc: "74951", price: "9", cost: "9", sortIndex: 5 },
];

function rate(
  patch: Partial<{
    category: string;
    status: string;
    billDnis: string;
    elapsedTime: string;
    rates: TariffRateLookup[];
  }> = {},
) {
  return rateCdrCall({
    category: CALL_CATEGORY.outgoing,
    status: CALL_STATUS.success,
    billDnis: "74951234567",
    elapsedTime: "60000",
    rates: RATES,
    ...patch,
  });
}

describe("elapsedMsToCeiledSeconds", () => {
  it("ceils milliseconds to whole seconds", () => {
    expect(elapsedMsToCeiledSeconds("24383")).toBe(BigInt(25));
    expect(elapsedMsToCeiledSeconds("1000")).toBe(BigInt(1));
    expect(elapsedMsToCeiledSeconds("1000.1")).toBe(BigInt(2));
    expect(elapsedMsToCeiledSeconds("0")).toBe(BigInt(0));
    expect(elapsedMsToCeiledSeconds("")).toBe(BigInt(0));
    expect(elapsedMsToCeiledSeconds("abc")).toBe(BigInt(0));
  });
});

describe("rateCdrCall", () => {
  it("uses the longest ABC and minute charge versus per-second cost", () => {
    expect(rate()).toEqual({
      direction: "Москва-центр",
      charge: "3.00",
      cost: "1.00",
      profit: "2.00",
    });
  });

  it("prefers the earlier file row when ABC length ties", () => {
    expect(
      rate({
        rates: [
          { direction: "Позже", abc: "7495", price: "9", cost: "9", sortIndex: 4 },
          { direction: "Раньше", abc: "7495", price: "2", cost: "1.2", sortIndex: 1 },
        ],
        billDnis: "74950000000",
        elapsedTime: "61000",
      }),
    ).toMatchObject({ direction: "Раньше", charge: "4.00", cost: "1.22", profit: "2.78" });
  });

  it("rates redirect and internal calls the same way", () => {
    expect(rate({ category: CALL_CATEGORY.redirect }).direction).toBe("Москва-центр");
    expect(rate({ category: CALL_CATEGORY.internal }).direction).toBe("Москва-центр");
  });

  it("sets parking cost to zero", () => {
    expect(rate({ category: CALL_CATEGORY.outgoingParking })).toEqual({
      direction: "Москва-центр",
      charge: "3.00",
      cost: "0.00",
      profit: "3.00",
    });
  });

  it("leaves every other category and failed calls empty", () => {
    expect(rate({ category: CALL_CATEGORY.incoming })).toEqual(EMPTY_CDR_TARIFF);
    expect(rate({ category: CALL_CATEGORY.incomingParking })).toEqual(EMPTY_CDR_TARIFF);
    expect(rate({ status: CALL_STATUS.failed, elapsedTime: "" })).toEqual(EMPTY_CDR_TARIFF);
    expect(rate({ billDnis: "84951234567" })).toEqual(EMPTY_CDR_TARIFF);
    expect(rate({ billDnis: "7495123456" })).toEqual(EMPTY_CDR_TARIFF);
    expect(rate({ billDnis: "+74951234567" })).toEqual(EMPTY_CDR_TARIFF);
    expect(rate({ rates: [] })).toEqual(EMPTY_CDR_TARIFF);
  });

  it("trims the B-number and ceils a fractional kopeck up", () => {
    expect(
      rate({
        billDnis: " 74950000000 ",
        elapsedTime: "1000",
        rates: [{ direction: "Москва", abc: "7495", price: "1.001", cost: "1", sortIndex: 0 }],
      }),
    ).toEqual({
      direction: "Москва",
      charge: "1.01",
      cost: "0.02",
      profit: "0.99",
    });
  });

  it("keeps an exact kopeck and writes zeros for a zero duration", () => {
    expect(
      rate({
        elapsedTime: "60000",
        rates: [{ direction: "Москва", abc: "7495", price: "1.22", cost: "1.22", sortIndex: 0 }],
      }),
    ).toMatchObject({ charge: "1.22", cost: "1.22", profit: "0.00" });
    expect(rate({ elapsedTime: "0" })).toMatchObject({
      charge: "0.00",
      cost: "0.00",
      profit: "0.00",
    });
  });

  it("ceils a negative rate toward positive infinity", () => {
    expect(
      rate({
        elapsedTime: "60000",
        rates: [{ direction: "Минус", abc: "7495", price: "-1.221", cost: "0", sortIndex: 0 }],
      }),
    ).toMatchObject({ charge: "-1.22", cost: "0.00", profit: "-1.22" });
  });

  it("leaves the row empty when the amount does not fit twelve integer digits", () => {
    expect(rate({ elapsedTime: "1" + "0".repeat(20) })).toEqual(EMPTY_CDR_TARIFF);
  });
});

describe("API key redaction", () => {
  it("drops cost and profit from the row and from filters", () => {
    expect(
      stripCdrTariffSecrets({
        tariff_direction: "Москва",
        tariff_charge: "1.00",
        tariff_cost: "0.02",
        tariff_profit: "0.98",
      }),
    ).toEqual({ tariff_direction: "Москва", tariff_charge: "1.00" });
    expect(
      omitCdrTariffSecretFilters({
        tariff_cost: ["0.02"],
        tariff_profit: ["0.98"],
        call_status: ["Успешный"],
      }),
    ).toEqual({ call_status: ["Успешный"] });
  });
});

describe("cdr tariff migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("rates only the agreed categories and guards unrelated updates", () => {
    expect(sql).toContain(CALL_CATEGORY.outgoing);
    expect(sql).toContain(CALL_CATEGORY.internal);
    expect(sql).toContain(CALL_CATEGORY.redirect);
    expect(sql).toContain(CALL_CATEGORY.outgoingParking);
    expect(sql).toContain(CALL_STATUS.success);
    expect(sql).toContain("OLD.call_category");
    expect(sql).toContain("cdr_rate_call");
    expect(sql).not.toContain("formatTariffDecimal");
  });
});

describe("tariff batch SQL", () => {
  it("matches the migrator script", () => {
    const script = readFileSync(
      path.join(process.cwd(), "scripts/cdr-tariff-backfill.mjs"),
      "utf8",
    );
    const start = script.indexOf("WITH batch AS");
    const end = script.indexOf("`.trim()", start);
    expect(start).toBeGreaterThan(-1);
    expect(script.slice(start, end).trim()).toBe(CDR_TARIFF_BATCH_SQL);
  });
});
