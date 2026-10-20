import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import { PARKING_DST } from "@/modules/stats/classify";
import {
  CALL_CATEGORY,
  CALL_STATUS,
  CALL_TYPE,
  classifyCallCategory as classifyCategory,
  classifyCallGeography,
  classifyCallStatus,
  classifyCallType,
  classifyExportStatus,
  renderCallCategoryCaseSql,
  renderCallStatusCaseSql,
  renderCallTypeCaseSql,
} from "@/modules/traffic/call-class";
import type { TariffAbcRate } from "@/modules/traffic/tariff-match";

const LABEL_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261005211500_cdr_call_class_labels/migration.sql",
);
const FAILED_PLURAL_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261005234000_cdr_failed_status_plural/migration.sql",
);
const CHECK_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261007143000_cdr_call_geography/migration.sql",
);
const LABEL_RENAME_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261007160000_cdr_call_category_labels/migration.sql",
);
const PARKING_STATUS_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261007200000_cdr_parking_status/migration.sql",
);
const CALL_TYPE_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261007210000_cdr_call_type/migration.sql",
);
const MOBILE_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261008020000_cdr_mobile_and_errors/migration.sql",
);
const DIRECTION_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261008170000_cdr_outgoing_direction/migration.sql",
);
const TERMINATOR_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261010120000_cdr_terminator_capacity/migration.sql",
);
const LENGTH_LIST_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261020180000_tariff_digit_lengths/migration.sql",
);
const CLOSED_PREFIX_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261020190000_closed_dial_prefixes/migration.sql",
);
const DIAL_EXCEPTION_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261020220000_dial_exceptions/migration.sql",
);

const cityRates: TariffAbcRate[] = [
  { direction: "г. Новосибирск", abc: "7383", sortIndex: 0, digitLengths: null },
  { direction: "г. Москва", abc: "7495", sortIndex: 1, digitLengths: null },
  { direction: "Билайн", abc: "7913", sortIndex: 2, digitLengths: null },
  { direction: "Россия", abc: "7", sortIndex: 3, digitLengths: null },
];

function classifyCallCategory(
  sideA: string,
  sideB: string,
  dstName: string,
  srcName = "",
  disconnectCode = "",
  dpName = "",
  billDnis = "",
  rates: readonly TariffAbcRate[] = cityRates,
): string {
  return classifyCategory(
    sideA,
    sideB,
    dstName,
    srcName,
    disconnectCode,
    dpName,
    billDnis,
    rates,
  );
}

describe("classifyCallCategory", () => {
  const known = "Офис";
  const unknown = MISSING_BILLING_LABEL;
  const nsk = "73831234567";
  const nskOther = "73839876543";
  const moscow = "74951234567";
  const mobile = "79131234567";
  const abroad = "442071234567";

  it("classifies direction when the terminator is not parking", () => {
    expect(classifyCallCategory(known, unknown, "PSTN_A", "", "", "", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(classifyCallCategory(unknown, known, "PSTN_A")).toBe(CALL_CATEGORY.incoming);
    expect(classifyCallCategory(known, known, "PSTN_A", "", "", "", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(classifyCallCategory("", "", "PSTN_A")).toBe(CALL_CATEGORY.errors);
    expect(classifyCallCategory(unknown, unknown, "PSTN_A")).toBe(CALL_CATEGORY.errors);
  });

  it("splits a known side A by numbers and one city direction", () => {
    expect(classifyCallGeography(nsk, nskOther, cityRates)).toBe("local");
    expect(classifyCallGeography(nsk, moscow, cityRates)).toBe("intercity");
    expect(classifyCallGeography(nsk, mobile, cityRates)).toBe("mobile");
    expect(classifyCallGeography(nsk, "4420712345", cityRates)).toBe("international");
    const belarus = "375291234567";
    expect(classifyCallCategory(known, known, "PSTN_A", "", "", "", belarus)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, belarus, cityRates),
    ).toBe(CALL_TYPE.international);
    const kazakhstanTwelve = "771234567890";
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", kazakhstanTwelve),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallType(
        known,
        known,
        "PSTN_A",
        "",
        "",
        "",
        nsk,
        kazakhstanTwelve,
        cityRates,
      ),
    ).toBe(CALL_TYPE.verify);
    expect(classifyCallGeography("100", nsk, cityRates)).toBe("intercity");
    expect(classifyCallGeography(nsk, nskOther, [])).toBe("intercity");
    expect(
      classifyCallGeography(nsk, nskOther, [
        { direction: "Новосибирск", abc: "7383", sortIndex: 0, digitLengths: null },
      ]),
    ).toBe("intercity");
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, "4420712345", cityRates),
    ).toBe(CALL_TYPE.international);
    expect(
      classifyCallType(known, unknown, PARKING_DST, "", "", "", nsk, nskOther, cityRates),
    ).toBe(CALL_TYPE.local);
    expect(
      classifyCallType(known, known, PARKING_DST, "", "", "", nsk, moscow, cityRates),
    ).toBe(CALL_TYPE.intercity);
    expect(
      classifyCallType(
        known,
        known,
        PARKING_DST,
        "",
        "",
        "",
        nsk,
        "4420712345",
        cityRates,
      ),
    ).toBe(CALL_TYPE.international);
    expect(classifyCallCategory(known, known, PARKING_DST, "", "", "", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
  });

  it("reads the A-number for incoming and phantom geography", () => {
    expect(classifyCallGeography(nsk, "4420712345", cityRates, "incoming")).toBe(
      "intercity",
    );
    expect(classifyCallGeography("4420712345", nsk, cityRates, "incoming")).toBe(
      "international",
    );
    expect(classifyCallGeography(nsk, nskOther, cityRates, "incoming")).toBe("local");
    expect(
      classifyCallType(
        unknown,
        known,
        "PSTN_A",
        "",
        "",
        "",
        "4420712345",
        nsk,
        cityRates,
      ),
    ).toBe(CALL_TYPE.international);
    expect(
      classifyCallType(unknown, known, "PSTN_A", "", "", "", nsk, moscow, cityRates),
    ).toBe(CALL_TYPE.intercity);
    expect(
      classifyCallType(
        unknown,
        unknown,
        PARKING_DST,
        "",
        "",
        "",
        "4420712345",
        nsk,
        cityRates,
      ),
    ).toBe(CALL_TYPE.international);
    expect(
      classifyCallType(
        unknown,
        unknown,
        PARKING_DST,
        "",
        "",
        "",
        nsk,
        nskOther,
        cityRates,
      ),
    ).toBe(CALL_TYPE.local);
    expect(classifyCallType("", "", "PSTN_A")).toBe(CALL_TYPE.verify);
  });

  it("classifies parking from the exact terminating device", () => {
    expect(classifyCallCategory(unknown, unknown, PARKING_DST)).toBe(
      CALL_CATEGORY.phantom,
    );
    expect(classifyCallCategory("", "", PARKING_DST)).toBe(CALL_CATEGORY.phantom);
    expect(classifyCallCategory(unknown, known, PARKING_DST)).toBe(
      CALL_CATEGORY.incoming,
    );
    expect(classifyCallCategory(known, unknown, PARKING_DST, "", "", "", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(
      classifyCallType(known, known, PARKING_DST, "", "", "", mobile, mobile, cityRates),
    ).toBe(CALL_TYPE.mobile);
    expect(
      classifyCallCategory(known, known, "Service_Parking_1", "", "", "", abroad),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(
      classifyCallType(known, known, "Service_Parking_1", "", "", "", nsk, abroad),
    ).toBe(CALL_TYPE.international);
    expect(
      classifyCallCategory(known, known, " Service_Parking", "", "", "", moscow),
    ).toBe(CALL_CATEGORY.outgoing);
  });

  it("prefers disconnect codes over redirect, check, and side direction", () => {
    const unregistered = "Class4, 1 - Unregistered IP Address";
    const routeError = "Class4, 40 - Gateway Is Invalid";
    expect(
      classifyCallCategory(
        known,
        known,
        "gw",
        "Redirect_1",
        unregistered,
        "Service_Check",
      ),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallType(known, known, "gw", "Redirect_1", unregistered, "Service_Check"),
    ).toBe(CALL_TYPE.unregistered);
    expect(
      classifyCallCategory(known, known, "gw", "Redirect_1", "", "Service_Check"),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(classifyCallCategory(known, known, "gw", "gw", "", "Service_Check")).toBe(
      CALL_CATEGORY.check,
    );
    expect(classifyCallCategory("Тест 1", known, PARKING_DST, "gw", unregistered)).toBe(
      CALL_CATEGORY.errors,
    );
    expect(classifyCallCategory(known, "Тест ", "gw", "gw", routeError)).toBe(
      CALL_CATEGORY.errors,
    );
    expect(
      classifyCallCategory(known, known, "Service_Check", "gw", "", "", abroad),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(
      classifyCallType(known, known, "Service_Check", "gw", "", "", nsk, abroad),
    ).toBe(CALL_TYPE.international);
    expect(classifyCallCategory(known, known, "gw", "RedirectX", "", "", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(
      classifyCallCategory(known, known, "gw", "gw", "", "Service_Check_1", moscow),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(
      classifyCallCategory(known, known, "gw", "gw", "", " Service_Check", moscow),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(
      classifyCallCategory(known, known, "gw", "gw", "", "Service_Check ", moscow),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(classifyCallCategory("Тест", known, "gw", "", "", "", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(classifyCallCategory("Тест_1", known, "gw", "", "", "", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(classifyCallCategory("Тестовый", known, "gw", "", "", "", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(classifyCallCategory(" Тест 1", known, "gw", "", "", "", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(classifyCallCategory("тест 1", known, "gw", "", "", "", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(classifyCallType(known, known, "gw", "gw", unregistered)).toBe(
      CALL_TYPE.unregistered,
    );
    expect(classifyCallType(known, known, "gw", "gw", "", "Service_Check")).toBe(
      CALL_TYPE.check,
    );
    expect(classifyCallType("", "", "PSTN_A", "gw", "")).toBe(CALL_TYPE.verify);
    expect(classifyCallCategory(known, known, "gw", "gw", unregistered)).toBe(
      CALL_CATEGORY.errors,
    );
    expect(classifyCallType(known, known, "gw", "gw", routeError)).toBe(
      CALL_TYPE.routeError,
    );
    expect(classifyCallCategory(known, known, PARKING_DST, "gw", routeError)).toBe(
      CALL_CATEGORY.errors,
    );
    expect(
      classifyCallCategory(
        known,
        known,
        "gw",
        "Redirect_1",
        "Class4, 4 - Originator Capacity Exceeded",
      ),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallType(
        known,
        known,
        "gw",
        "Redirect_1",
        "Class4, 4 - Originator Capacity Exceeded",
      ),
    ).toBe(CALL_TYPE.capacity);
    expect(
      classifyCallCategory(
        known,
        known,
        "gw",
        "Redirect_1",
        "Class4, 5 - Terminator Capacity Exceeded",
      ),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallType(
        known,
        known,
        "gw",
        "Redirect_1",
        "Class4, 5 - Terminator Capacity Exceeded",
      ),
    ).toBe(CALL_TYPE.capacity);
    expect(classifyCallCategory(known, known, "gw", "", "", "", "79")).toBe(
      CALL_CATEGORY.errors,
    );
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, "79")).toBe(
      CALL_TYPE.verify,
    );
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, "7123456789")).toBe(
      CALL_TYPE.verify,
    );
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, "7 901")).toBe(
      CALL_TYPE.verify,
    );
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, "")).toBe(
      CALL_TYPE.verify,
    );
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, "1".repeat(16))).toBe(
      CALL_TYPE.verify,
    );
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, abroad)).toBe(
      CALL_TYPE.international,
    );
    expect(classifyCallType(unknown, known, "gw", "", "", "", "79", nsk)).toBe(
      CALL_TYPE.international,
    );
    expect(
      classifyCallType(known, known, "gw", "", "", "", nsk, ` ${mobile} `, [
        { direction: "Мобильный", abc: "79", sortIndex: 0, digitLengths: null },
      ]),
    ).toBe(CALL_TYPE.mobile);
  });

  it("sends an uncovered length to verify and keeps an unknown code", () => {
    const belarus = "375291234567";
    const belarusLong = "3752912345678";
    const lengths = [
      { direction: "Беларусь", abc: "375", sortIndex: 0, digitLengths: [12, 13] },
    ];
    const onlyTwelve = [
      { direction: "Беларусь", abc: "375", sortIndex: 0, digitLengths: [12] },
    ];
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", belarus, lengths),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, belarusLong, lengths),
    ).toBe(CALL_TYPE.international);
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", belarusLong, onlyTwelve),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, belarusLong, onlyTwelve),
    ).toBe(CALL_TYPE.verify);
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", "331234567890", []),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, "331234567890", []),
    ).toBe(CALL_TYPE.international);
    expect(classifyCallCategory(known, known, "PSTN_A", "", "", "", moscow, [])).toBe(
      CALL_CATEGORY.errors,
    );
    expect(classifyCallType(known, known, "PSTN_A", "", "", "", nsk, moscow, [])).toBe(
      CALL_TYPE.verify,
    );
    const uncovered = "75001234567";
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", uncovered, [
        { direction: "Москва", abc: "7495", sortIndex: 0, digitLengths: null },
      ]),
    ).toBe(CALL_CATEGORY.errors);
    const kazakhstan = "77123456789";
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", kazakhstan, [
        { direction: "Казахстан", abc: "77", sortIndex: 0, digitLengths: [11, 12] },
      ]),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, kazakhstan, [
        { direction: "Казахстан", abc: "77", sortIndex: 0, digitLengths: [12] },
      ]),
    ).toBe(CALL_TYPE.international);
    expect(
      classifyCallCategory(known, known, "gw", "Redirect_1", "", "", "771234567890", []),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(
      classifyCallType(known, known, "gw", "Redirect_1", "", "", nsk, "771234567890", []),
    ).toBe(CALL_TYPE.redirect);
  });

  it("sends an uncovered closed prefix to verify and keeps 880 and 33", () => {
    const eight = [
      { direction: "Восьмёрка", abc: "8", sortIndex: 0, digitLengths: null },
    ];
    const code = "831234567890";
    expect(classifyCallCategory(known, known, "PSTN_A", "", "", "", code, [])).toBe(
      CALL_CATEGORY.errors,
    );
    expect(classifyCallType(known, known, "PSTN_A", "", "", "", nsk, code, [])).toBe(
      CALL_TYPE.verify,
    );
    expect(classifyCallCategory(known, known, "PSTN_A", "", "", "", code, eight)).toBe(
      CALL_CATEGORY.errors,
    );
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", "887123456789", eight),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", "889123456789", [
        { direction: "Восемь девять", abc: "89", sortIndex: 0, digitLengths: null },
      ]),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", "891234567890", []),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", "0123456789", eight),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", "083012345678", [
        { direction: "Код", abc: "83", sortIndex: 0, digitLengths: null },
      ]),
    ).toBe(CALL_CATEGORY.errors);
    expect(classifyCallCategory(known, known, "PSTN_A", "", "", "", "*123", [])).toBe(
      CALL_CATEGORY.errors,
    );
    expect(classifyCallType(known, known, "PSTN_A", "", "", "", nsk, "*", [])).toBe(
      CALL_TYPE.verify,
    );
    expect(
      classifyCallType(
        known,
        known,
        "PSTN_A",
        "",
        "",
        "",
        nsk,
        ` ${"*".repeat(20)} `,
        [],
      ),
    ).toBe(CALL_TYPE.verify);
    const own = [
      { direction: "Код 8301", abc: "8301", sortIndex: 0, digitLengths: [12] },
    ];
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", "830112345678", own),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, "830112345678", own),
    ).toBe(CALL_TYPE.international);
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", "83011234567", [
        ...own,
        ...eight,
      ]),
    ).toBe(CALL_CATEGORY.errors);
    const either = [
      { direction: "Код 83", abc: "83", sortIndex: 0, digitLengths: [12, 13] },
    ];
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, "831234567890", either),
    ).toBe(CALL_TYPE.international);
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", "8312345678901", either),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", "83123456789", either),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, "880123456789", []),
    ).toBe(CALL_TYPE.international);
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, "331234567890", []),
    ).toBe(CALL_TYPE.international);
    const germany = [
      { direction: "Германия", abc: "49", sortIndex: 0, digitLengths: [12, 13] },
    ];
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, "491234567890", germany),
    ).toBe(CALL_TYPE.international);
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", "49123456789", germany),
    ).toBe(CALL_CATEGORY.errors);
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, "83", either)).toBe(
      CALL_TYPE.verify,
    );
    expect(
      classifyCallCategory(known, known, "gw", "Redirect_1", "", "", "*1234567890", []),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(
      classifyCallType(known, known, "gw", "Redirect_1", "", "", nsk, "*1234567890", []),
    ).toBe(CALL_TYPE.redirect);
    expect(
      classifyCallCategory(unknown, known, "PSTN_A", "", "", "", "831234567890", []),
    ).toBe(CALL_CATEGORY.incoming);
  });

  it("sends * or # anywhere to verify and uses the passed exception list", () => {
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", "12*34567890", []),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, "7495#1234567", []),
    ).toBe(CALL_TYPE.verify);
    expect(classifyCallType(known, known, "PSTN_A", "", "", "", nsk, "#100", [])).toBe(
      CALL_TYPE.verify,
    );
    expect(
      classifyCategory(known, known, "PSTN_A", "", "", "", "880123456789", [], ["880"]),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallType(
        known,
        known,
        "PSTN_A",
        "",
        "",
        "",
        nsk,
        "880123456789",
        [],
        ["880"],
      ),
    ).toBe(CALL_TYPE.verify);
    expect(
      classifyCategory(known, known, "PSTN_A", "", "", "", "831234567890", [], []),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(
      classifyCallType(known, known, "PSTN_A", "", "", "", nsk, "831234567890", [], []),
    ).toBe(CALL_TYPE.international);
  });
});

describe("classifyCallStatus", () => {
  const known = "Офис";
  const unknown = MISSING_BILLING_LABEL;
  const routeError = "Class4, 40 - Gateway Is Invalid";

  it("treats only an empty string as failed", () => {
    expect(classifyCallStatus("")).toBe(CALL_STATUS.failed);
    expect(classifyCallStatus("0")).toBe(CALL_STATUS.success);
    expect(classifyCallStatus("24383")).toBe(CALL_STATUS.success);
    expect(classifyExportStatus(undefined)).toBe(CALL_STATUS.success);
    expect(classifyExportStatus("")).toBe(CALL_STATUS.failed);
    expect(classifyCallStatus("", known, known, PARKING_DST)).toBe(CALL_STATUS.failed);
  });

  it("marks successful parking, including redirect and check", () => {
    expect(classifyCallStatus("1", known, unknown, PARKING_DST)).toBe(
      CALL_STATUS.parking,
    );
    expect(classifyCallStatus("0", unknown, known, PARKING_DST)).toBe(
      CALL_STATUS.parking,
    );
    expect(classifyCallStatus("1", unknown, unknown, PARKING_DST)).toBe(
      CALL_STATUS.parking,
    );
    expect(classifyCallStatus("1", known, known, "PSTN_A")).toBe(CALL_STATUS.success);
    expect(
      classifyCallStatus("1", known, known, PARKING_DST, "Redirect_1", routeError),
    ).toBe(CALL_STATUS.parking);
    expect(classifyCallStatus("1", known, known, PARKING_DST, "gw", routeError)).toBe(
      CALL_STATUS.parking,
    );
    expect(
      classifyCallStatus("1", "Тест 1", unknown, PARKING_DST, "gw", routeError),
    ).toBe(CALL_STATUS.parking);
    expect(classifyExportStatus(undefined, known, unknown, PARKING_DST)).toBe(
      CALL_STATUS.parking,
    );
    expect(classifyExportStatus("", known, unknown, PARKING_DST)).toBe(
      CALL_STATUS.failed,
    );
  });
});

describe("call class SQL", () => {
  it("is the function body stored in the migration", () => {
    const geography = readFileSync(CHECK_MIGRATION, "utf8");
    const renamed = readFileSync(LABEL_RENAME_MIGRATION, "utf8");
    const parking = readFileSync(PARKING_STATUS_MIGRATION, "utf8");
    const labels = readFileSync(LABEL_MIGRATION, "utf8");
    const failedPlural = readFileSync(FAILED_PLURAL_MIGRATION, "utf8");
    const callType = readFileSync(CALL_TYPE_MIGRATION, "utf8");
    const mobile = readFileSync(MOBILE_MIGRATION, "utf8");
    const direction = readFileSync(DIRECTION_MIGRATION, "utf8");
    const terminator = readFileSync(TERMINATOR_MIGRATION, "utf8");
    expect(terminator).not.toContain(renderCallCategoryCaseSql());
    expect(terminator).not.toContain(renderCallTypeCaseSql());
    expect(terminator).not.toContain("cdr_tariff_length_mismatch");
    const lengths = readFileSync(LENGTH_LIST_MIGRATION, "utf8");
    const closed = readFileSync(CLOSED_PREFIX_MIGRATION, "utf8");
    expect(closed).toContain("CREATE OR REPLACE FUNCTION cdr_tariff_length_mismatch");
    expect(closed).toContain("starts_with(b, '*')");
    expect(closed).toContain("starts_with(t.abc, '887')");
    expect(closed).toContain("starts_with(t.abc, '83')");
    expect(closed).toContain("starts_with(t.abc, '0')");
    expect(closed.indexOf("starts_with(b, '*')")).toBeLessThan(
      closed.indexOf("b ~ '^[0-9]{10,15}$'"),
    );
    expect(closed).not.toContain("DROP FUNCTION");
    expect(closed).not.toContain("CREATE OR REPLACE FUNCTION cdr_call_category");
    expect(closed).not.toContain(renderCallCategoryCaseSql());
    expect(closed).not.toContain(renderCallTypeCaseSql());
    const exceptions = readFileSync(DIAL_EXCEPTION_MIGRATION, "utf8");
    expect(exceptions).toContain('CREATE TABLE "dial_exceptions"');
    expect(exceptions).toContain("CHECK (\"abc\" ~ '^[0-9]{1,15}$')");
    expect(exceptions).toContain("('887')");
    expect(exceptions).not.toContain("('*'");
    expect(exceptions).toContain("b ~ '[*#]'");
    expect(exceptions).toContain("FROM dial_exceptions AS e");
    expect(exceptions).toContain("ORDER BY length(e.abc) DESC");
    expect(exceptions.indexOf("b ~ '[*#]'")).toBeLessThan(
      exceptions.indexOf("FROM dial_exceptions AS e"),
    );
    expect(exceptions.indexOf("FROM dial_exceptions AS e")).toBeLessThan(
      exceptions.indexOf("b ~ '^[0-9]{10,15}$'"),
    );
    expect(exceptions).toContain(
      '"rateGeneration" = "tariff_import_state"."rateGeneration" + 1',
    );
    expect(exceptions).not.toContain('"ratedGeneration" = "rateGeneration"');
    expect(exceptions).not.toContain("CREATE OR REPLACE FUNCTION cdr_call_category");
    expect(exceptions).not.toContain("CREATE OR REPLACE FUNCTION cdr_call_type");
    expect(exceptions).not.toContain(renderCallCategoryCaseSql());
    expect(exceptions).not.toContain(renderCallTypeCaseSql());
    expect(lengths).toContain(renderCallCategoryCaseSql());
    expect(lengths).toContain(renderCallTypeCaseSql());
    expect(lengths).toContain("CREATE OR REPLACE FUNCTION cdr_call_category");
    expect(lengths).toContain("CREATE OR REPLACE FUNCTION cdr_call_type");
    expect(lengths).not.toContain("DROP FUNCTION");
    expect(terminator).toContain("CREATE OR REPLACE FUNCTION cdr_call_category");
    expect(terminator).toContain("CREATE OR REPLACE FUNCTION cdr_call_type");
    expect(terminator).not.toContain("DROP FUNCTION");
    expect(terminator).not.toContain("CREATE OR REPLACE FUNCTION cdr_rate_call");
    expect(terminator).not.toContain("CREATE OR REPLACE FUNCTION cdr_call_status");
    expect(direction).not.toContain(renderCallCategoryCaseSql());
    expect(direction).not.toContain("DROP FUNCTION");
    expect(direction).not.toContain("CREATE OR REPLACE FUNCTION cdr_call_type");
    expect(direction).not.toContain("CREATE OR REPLACE FUNCTION cdr_call_geography");
    expect(mobile).not.toContain(renderCallCategoryCaseSql());
    expect(mobile).toContain("'Исходящие'");
    expect(mobile).toContain("'Ошибки'");
    expect(mobile).not.toContain(renderCallTypeCaseSql());
    expect(mobile).toContain(renderCallStatusCaseSql());
    expect(mobile.indexOf("RETURN 'mobile'")).toBeLessThan(
      mobile.indexOf("RETURN 'international'"),
    );
    expect(mobile).toContain("'Мобильный'");
    expect(mobile).toContain("seconds <= 3");
    expect(mobile).not.toContain("73|74|78|79");
    expect(mobile).not.toContain("DROP FUNCTION");
    expect(
      readFileSync(
        path.join(
          process.cwd(),
          "prisma/migrations/20261008001000_cdr_minute_grace/migration.sql",
        ),
        "utf8",
      ),
    ).not.toContain("'Мобильный'");
    expect(callType.indexOf("CREATE FUNCTION cdr_rate_call")).toBeLessThan(
      callType.indexOf("DROP FUNCTION cdr_rate_call(text, text, text, text)"),
    );
    expect(
      callType.indexOf("DROP FUNCTION cdr_rate_call(text, text, text, text)"),
    ).toBeLessThan(callType.indexOf("DROP FUNCTION cdr_call_geography(text, text)"));
    expect(parking).not.toContain(renderCallCategoryCaseSql());
    expect(parking).not.toContain(renderCallStatusCaseSql());
    expect(parking).toContain("'Неуспешные'");
    expect(parking).toContain("'Местный звонок'");
    expect(parking).toContain(
      "status IS DISTINCT FROM 'Успешный' AND status IS DISTINCT FROM 'Паркинг'",
    );
    expect(parking.indexOf("CREATE FUNCTION cdr_call_status")).toBeLessThan(
      parking.indexOf("DROP FUNCTION cdr_call_status(text)"),
    );
    expect(renamed).toContain("category IN ('Местный', 'Местный (П)')");
    expect(renamed).toContain("'Местный звонок'");
    expect(renamed).not.toContain("'Исходящий местный'");
    expect(renamed).not.toContain("DROP FUNCTION");
    expect(renamed).not.toContain(renderCallCategoryCaseSql());
    expect(failedPlural).toContain(
      "CASE WHEN elapsed_time = '' THEN 'Неуспешные' ELSE 'Успешный' END",
    );
    expect(failedPlural).not.toContain(renderCallStatusCaseSql());
    expect(labels).toContain("'Неуспешный'");
    expect(labels).not.toContain("'Неуспешные'");
    expect(geography).toContain("'Исходящий местный'");
    expect(geography).toContain("NEW.bill_ani");
    expect(geography).toContain("NEW.bill_dnis");
    expect(geography).toContain(
      "DROP FUNCTION cdr_call_category(text, text, text, text, text, text);",
    );
    expect(geography).not.toContain("CASCADE");
  });

  it("does not treat the live error category as a stale parking label", () => {
    const script = readFileSync(
      path.join(process.cwd(), "scripts/cdr-call-class-backfill.mjs"),
      "utf8",
    );
    const labels = script.match(/const PARKING_CATEGORY_LABELS = \[([\s\S]*?)\];/);
    expect(labels?.[1]).toBeDefined();
    expect(labels?.[1]).not.toContain(CALL_CATEGORY.errors);
    expect(labels?.[1]).not.toContain('"Ошибка"');
  });
});
