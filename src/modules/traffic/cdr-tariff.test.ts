import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MINUTE_GRACE_SECONDS } from "@/modules/enrich/types";
import { CALL_CATEGORY, CALL_STATUS, CALL_TYPE } from "@/modules/traffic/call-class";
import {
  EMPTY_CDR_TARIFF,
  elapsedMsToCeiledSeconds,
  rateCdrCall,
  type TariffRateLookup,
} from "@/modules/traffic/cdr-tariff";
import { CDR_TARIFF_BATCH_SQL } from "@/modules/traffic/tariff-rate/sql";

const MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261006210000_cdr_tariff_rating/migration.sql",
);
const PRICE_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261006223000_cdr_tariff_price/migration.sql",
);
const INTERNAL_ZERO_COST_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261006225000_cdr_internal_zero_cost/migration.sql",
);
const DROP_COST_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261006233000_drop_tariff_cost_profit/migration.sql",
);
const GRACE_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261008001000_cdr_minute_grace/migration.sql",
);

const RATES: TariffRateLookup[] = [
  { direction: "Россия", abc: "7", price: "1", sortIndex: 0 },
  { direction: "Москва", abc: "7495", price: "2", sortIndex: 1 },
  { direction: "Москва-центр", abc: "74951", price: "3", sortIndex: 2 },
  { direction: "Москва-позже", abc: "74951", price: "9", sortIndex: 5 },
];

function rate(
  patch: Partial<{
    category: string;
    callType: string;
    status: string;
    billDnis: string;
    elapsedTime: string;
    rates: TariffRateLookup[];
  }> = {},
) {
  return rateCdrCall({
    category: CALL_CATEGORY.outgoing,
    callType: CALL_TYPE.intercity,
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
  it("uses the longest ABC and a whole-minute charge", () => {
    expect(rate()).toEqual({
      direction: "Москва-центр",
      price: "3",
      charge: "3.00",
    });
  });

  it("prefers the earlier file row when ABC length ties", () => {
    expect(
      rate({
        rates: [
          { direction: "Позже", abc: "7495", price: "9", sortIndex: 4 },
          { direction: "Раньше", abc: "7495", price: "2", sortIndex: 1 },
        ],
        billDnis: "74950000000",
        elapsedTime: "61000",
      }),
    ).toEqual({ direction: "Раньше", price: "2", charge: "4.00" });
  });

  it("rates a redirect the same way as an intercity call", () => {
    expect(rate({ callType: CALL_TYPE.redirect })).toEqual(rate());
  });

  it("writes the catalog direction and no money for a local outgoing call", () => {
    const local = {
      direction: "Москва-центр",
      charge: "",
      price: "",
    };
    expect(rate({ callType: CALL_TYPE.local })).toEqual(local);
    expect(
      rate({
        callType: CALL_TYPE.local,
        status: CALL_STATUS.parking,
        elapsedTime: "60000",
      }),
    ).toEqual(local);
    expect(
      rate({
        callType: CALL_TYPE.local,
        status: CALL_STATUS.failed,
        elapsedTime: "",
      }),
    ).toEqual(EMPTY_CDR_TARIFF);
    expect(
      rate({ category: CALL_CATEGORY.incoming, callType: CALL_TYPE.local }),
    ).toEqual(EMPTY_CDR_TARIFF);
    expect(
      rate({ category: CALL_CATEGORY.phantom, callType: CALL_TYPE.local }),
    ).toEqual(EMPTY_CDR_TARIFF);
  });

  it("rates an outgoing mobile call from the catalog row of the B-number", () => {
    const rates = [
      { direction: "Россия", abc: "7", price: "1", sortIndex: 0 },
      { direction: "Билайн", abc: "7913", price: "4", sortIndex: 1 },
    ];
    expect(
      rate({ callType: CALL_TYPE.mobile, billDnis: "79131234567", rates, elapsedTime: "60000" }),
    ).toEqual({ direction: "Билайн", price: "4", charge: "4.00" });
    expect(
      rate({
        callType: CALL_TYPE.mobile,
        billDnis: "79131234567",
        rates,
        status: CALL_STATUS.parking,
        elapsedTime: "60000",
      }),
    ).toEqual({ direction: "Билайн", price: "4", charge: "4.00" });
    expect(
      rate({
        callType: CALL_TYPE.mobile,
        billDnis: "79131234567",
        rates,
        elapsedTime: "3000",
      }),
    ).toEqual({ direction: "Билайн", price: "4", charge: "0.00" });
    expect(rate({ category: CALL_CATEGORY.incoming, callType: CALL_TYPE.mobile })).toEqual(
      EMPTY_CDR_TARIFF,
    );
  });

  it("rates intercity, international, and redirect parking the same way as a success", () => {
    const rated = {
      direction: "Москва-центр",
      price: "3",
      charge: "3.00",
    };
    expect(rate({ callType: CALL_TYPE.intercity })).toEqual(rated);
    expect(
      rate({
        callType: CALL_TYPE.intercity,
        status: CALL_STATUS.parking,
      }),
    ).toEqual(rated);
    expect(
      rate({
        callType: CALL_TYPE.redirect,
        status: CALL_STATUS.parking,
      }),
    ).toEqual(rated);
    expect(rate({ callType: CALL_TYPE.international, billDnis: "74951234567" })).toEqual(
      rated,
    );
    expect(
      rate({
        callType: CALL_TYPE.international,
        status: CALL_STATUS.parking,
        billDnis: "74951234567",
      }),
    ).toEqual(rated);
    expect(
      rate({
        callType: CALL_TYPE.intercity,
        status: CALL_STATUS.failed,
        elapsedTime: "",
      }),
    ).toEqual(EMPTY_CDR_TARIFF);
  });

  it("leaves every other category and failed calls empty", () => {
    expect(rate({ category: CALL_CATEGORY.incoming })).toEqual(EMPTY_CDR_TARIFF);
    expect(
      rate({ category: CALL_CATEGORY.incoming, status: CALL_STATUS.parking }),
    ).toEqual(EMPTY_CDR_TARIFF);
    expect(rate({ category: CALL_CATEGORY.check, status: CALL_STATUS.parking })).toEqual(
      EMPTY_CDR_TARIFF,
    );
    expect(rate({ category: CALL_CATEGORY.errors, callType: CALL_TYPE.capacity })).toEqual(
      EMPTY_CDR_TARIFF,
    );
    expect(rate({ status: CALL_STATUS.failed, elapsedTime: "" })).toEqual(
      EMPTY_CDR_TARIFF,
    );
    expect(rate({ billDnis: "84951234567" })).toEqual(EMPTY_CDR_TARIFF);
    expect(rate({ billDnis: "7495123456" })).toEqual(EMPTY_CDR_TARIFF);
    expect(rate({ billDnis: "+74951234567" })).toEqual(EMPTY_CDR_TARIFF);
    expect(rate({ rates: [] })).toEqual(EMPTY_CDR_TARIFF);
  });

  it("trims the B-number and ceils a fractional kopeck up", () => {
    expect(
      rate({
        billDnis: " 74950000000 ",
        elapsedTime: "4000",
        rates: [{ direction: "Москва", abc: "7495", price: "1.001", sortIndex: 0 }],
      }),
    ).toEqual({
      direction: "Москва",
      price: "1.001",
      charge: "1.01",
    });
  });

  it("keeps an exact kopeck and writes zeros for a zero duration", () => {
    expect(
      rate({
        elapsedTime: "60000",
        rates: [{ direction: "Москва", abc: "7495", price: "1.22", sortIndex: 0 }],
      }),
    ).toMatchObject({ charge: "1.22" });
    expect(rate({ elapsedTime: "0" })).toMatchObject({
      price: "3",
      charge: "0.00",
    });
  });

  it("ceils a negative rate toward positive infinity", () => {
    expect(
      rate({
        elapsedTime: "60000",
        rates: [{ direction: "Минус", abc: "7495", price: "-1.221", sortIndex: 0 }],
      }),
    ).toMatchObject({ charge: "-1.22" });
  });

  it("leaves the row empty when the amount does not fit twelve integer digits", () => {
    expect(rate({ elapsedTime: "1" + "0".repeat(20) })).toEqual(EMPTY_CDR_TARIFF);
  });

  it("charges zero through three seconds and one minute from the fourth", () => {
    const priced = { direction: "Москва-центр", price: "3" };
    expect(rate({ elapsedTime: "1000" })).toEqual({ ...priced, charge: "0.00" });
    expect(rate({ elapsedTime: "2000" })).toEqual({ ...priced, charge: "0.00" });
    expect(rate({ elapsedTime: "3000" })).toEqual({ ...priced, charge: "0.00" });
    expect(rate({ elapsedTime: "3001" })).toEqual({ ...priced, charge: "3.00" });
    expect(rate({ elapsedTime: "4000" })).toEqual({ ...priced, charge: "3.00" });
    expect(rate({ elapsedTime: "61000" })).toEqual({ ...priced, charge: "6.00" });
  });
});

describe("cdr tariff migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("rates only the agreed categories and guards unrelated updates", () => {
    expect(sql).toContain("Исходящий звонок");
    expect(sql).toContain("Внутренний звонок");
    expect(sql).toContain("Редирект");
    expect(sql).toContain("Исходящий паркинг");
    expect(sql).toContain(CALL_STATUS.success);
    expect(sql).toContain("OLD.call_category");
    expect(sql).toContain("cdr_rate_call");
    expect(sql).not.toContain("tariff_price");
    expect(sql).not.toContain("formatTariffDecimal");
  });

  it("zeros internal cost without rewriting the shipped rating functions", () => {
    const sql = readFileSync(INTERNAL_ZERO_COST_MIGRATION, "utf8");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION cdr_rate_call");
    expect(sql).toContain("category IN ('Исходящий паркинг', 'Внутренний звонок')");
    expect(sql).toContain(CALL_STATUS.success);
    expect(readFileSync(MIGRATION, "utf8")).toContain(
      "IF category = 'Исходящий паркинг' THEN",
    );
    expect(readFileSync(PRICE_MIGRATION, "utf8")).toContain(
      "IF category = 'Исходящий паркинг' THEN",
    );
  });

  it("drops cost and profit without rewriting the shipped rating functions", () => {
    const sql = readFileSync(DROP_COST_MIGRATION, "utf8");
    expect(sql).toContain("DROP FUNCTION cdr_rate_call(text, text, text, text)");
    expect(sql).toContain('DROP COLUMN "tariff_cost"');
    expect(sql).toContain('DROP COLUMN "tariff_profit"');
    expect(sql).toContain('DROP COLUMN "cost"');
    expect(sql).not.toContain("t.cost");
    expect(sql).not.toContain("NEW.tariff_cost");
    expect(sql).toContain("Внутренний звонок");
    expect(sql).toContain("Исходящий паркинг");
    expect(readFileSync(INTERNAL_ZERO_COST_MIGRATION, "utf8")).toContain(
      "category IN ('Исходящий паркинг', 'Внутренний звонок')",
    );
  });

  it("rates mobile calls without dropping the grace or the rater", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "prisma/migrations/20261008020000_cdr_mobile_and_errors/migration.sql"),
      "utf8",
    );
    expect(sql).toContain("CREATE OR REPLACE FUNCTION cdr_rate_call");
    expect(sql).not.toContain("DROP FUNCTION");
    expect(sql).toContain(`seconds <= ${MINUTE_GRACE_SECONDS}`);
    expect(sql).toContain("'Мобильный'");
    expect(readFileSync(GRACE_MIGRATION, "utf8")).not.toContain("'Мобильный'");
  });

  it("applies the minute grace without dropping the rater", () => {
    const sql = readFileSync(GRACE_MIGRATION, "utf8");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION cdr_rate_call");
    expect(sql).not.toContain("DROP FUNCTION");
    expect(sql).toContain(`seconds <= ${MINUTE_GRACE_SECONDS}`);
    expect(sql).toContain("minutes := 0");
    expect(sql).toContain("minutes := ceil(seconds / 60)");
    expect(sql).toContain("Исходящие");
    expect(sql).toContain("Местный");
    expect(sql).toContain("Междугородный");
  });

  it("adds the catalog price without rewriting the shipped rating migration", () => {
    const sql = readFileSync(PRICE_MIGRATION, "utf8");
    expect(sql).toContain('ADD COLUMN "tariff_price"');
    expect(sql).toContain("cdr_tariff_price_text");
    expect(sql).toContain("DROP FUNCTION cdr_rate_call(text, text, text, text)");
    expect(sql).toContain("NEW.tariff_price");
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
