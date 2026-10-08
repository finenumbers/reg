import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import { PARKING_DST } from "@/modules/stats/classify";
import {
  CALL_CATEGORY,
  CALL_STATUS,
  CALL_TYPE,
  classifyCallCategory,
  classifyCallGeography,
  classifyCallStatus,
  classifyCallType,
  classifyExportStatus,
  renderCallCategoryCaseSql,
  renderCallStatusCaseSql,
  renderCallTypeCaseSql,
} from "@/modules/traffic/call-class";

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

describe("classifyCallCategory", () => {
  const known = "Офис";
  const unknown = MISSING_BILLING_LABEL;
  const cityRates = [
    { direction: "г. Новосибирск", abc: "7383", sortIndex: 0 },
    { direction: "г. Москва", abc: "7495", sortIndex: 1 },
    { direction: "Билайн", abc: "7913", sortIndex: 2 },
    { direction: "Россия", abc: "7", sortIndex: 3 },
  ];
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
    expect(classifyCallGeography("100", nsk, cityRates)).toBe("intercity");
    expect(classifyCallGeography(nsk, nskOther, [])).toBe("intercity");
    expect(
      classifyCallGeography(nsk, nskOther, [
        { direction: "Новосибирск", abc: "7383", sortIndex: 0 },
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
      classifyCallType(known, known, PARKING_DST, "", "", "", nsk, "4420712345", cityRates),
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
      classifyCallType(unknown, known, "PSTN_A", "", "", "", "4420712345", nsk, cityRates),
    ).toBe(CALL_TYPE.international);
    expect(
      classifyCallType(unknown, known, "PSTN_A", "", "", "", nsk, moscow, cityRates),
    ).toBe(CALL_TYPE.intercity);
    expect(
      classifyCallType(unknown, unknown, PARKING_DST, "", "", "", "4420712345", nsk, cityRates),
    ).toBe(CALL_TYPE.international);
    expect(
      classifyCallType(unknown, unknown, PARKING_DST, "", "", "", nsk, nskOther, cityRates),
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
    expect(classifyCallCategory(known, known, "Service_Parking_1", "", "", "", abroad)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(classifyCallType(known, known, "Service_Parking_1", "", "", "", nsk, abroad)).toBe(
      CALL_TYPE.international,
    );
    expect(classifyCallCategory(known, known, " Service_Parking", "", "", "", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
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
    expect(classifyCallCategory(known, known, "Service_Check", "gw", "", "", abroad)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(classifyCallType(known, known, "Service_Check", "gw", "", "", nsk, abroad)).toBe(
      CALL_TYPE.international,
    );
    expect(classifyCallCategory(known, known, "gw", "RedirectX", "", "", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(classifyCallCategory(known, known, "gw", "gw", "", "Service_Check_1", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(classifyCallCategory(known, known, "gw", "gw", "", " Service_Check", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
    expect(classifyCallCategory(known, known, "gw", "gw", "", "Service_Check ", moscow)).toBe(
      CALL_CATEGORY.outgoing,
    );
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
    expect(classifyCallType(known, known, "gw", "gw", unregistered)).toBe(CALL_TYPE.unregistered);
    expect(classifyCallType(known, known, "gw", "gw", "", "Service_Check")).toBe(
      CALL_TYPE.check,
    );
    expect(classifyCallType("", "", "PSTN_A", "gw", "")).toBe(CALL_TYPE.verify);
    expect(classifyCallCategory(known, known, "gw", "gw", unregistered)).toBe(
      CALL_CATEGORY.errors,
    );
    expect(classifyCallType(known, known, "gw", "gw", routeError)).toBe(CALL_TYPE.routeError);
    expect(classifyCallCategory(known, known, PARKING_DST, "gw", routeError)).toBe(
      CALL_CATEGORY.errors,
    );
    expect(
      classifyCallCategory(known, known, "gw", "Redirect_1", "Class4, 4 - Originator Capacity Exceeded"),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      classifyCallType(known, known, "gw", "Redirect_1", "Class4, 4 - Originator Capacity Exceeded"),
    ).toBe(CALL_TYPE.capacity);
    expect(classifyCallCategory(known, known, "gw", "", "", "", "79")).toBe(CALL_CATEGORY.errors);
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, "79")).toBe(CALL_TYPE.verify);
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, "7123456789")).toBe(
      CALL_TYPE.verify,
    );
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, "7 901")).toBe(CALL_TYPE.verify);
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, "")).toBe(CALL_TYPE.verify);
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, "1".repeat(16))).toBe(
      CALL_TYPE.verify,
    );
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, abroad)).toBe(
      CALL_TYPE.international,
    );
    expect(classifyCallType(unknown, known, "gw", "", "", "", "79", nsk)).toBe(
      CALL_TYPE.international,
    );
    expect(classifyCallType(known, known, "gw", "", "", "", nsk, ` ${mobile} `)).toBe(
      CALL_TYPE.mobile,
    );
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
    expect(direction).toContain(renderCallCategoryCaseSql());
    expect(direction).not.toContain("DROP FUNCTION");
    expect(direction).not.toContain("CREATE OR REPLACE FUNCTION cdr_call_type");
    expect(direction).not.toContain("CREATE OR REPLACE FUNCTION cdr_call_geography");
    expect(mobile).not.toContain(renderCallCategoryCaseSql());
    expect(mobile).toContain("'Исходящие'");
    expect(mobile).toContain("'Ошибки'");
    expect(mobile).toContain(renderCallTypeCaseSql());
    expect(mobile).toContain(renderCallStatusCaseSql());
    expect(mobile.indexOf("RETURN 'mobile'")).toBeLessThan(mobile.indexOf("RETURN 'international'"));
    expect(mobile).toContain("'Мобильный'");
    expect(mobile).toContain("seconds <= 3");
    expect(mobile).not.toContain("73|74|78|79");
    expect(mobile).not.toContain("DROP FUNCTION");
    expect(readFileSync(
      path.join(process.cwd(), "prisma/migrations/20261008001000_cdr_minute_grace/migration.sql"),
      "utf8",
    )).not.toContain("'Мобильный'");
    expect(callType.indexOf("CREATE FUNCTION cdr_rate_call")).toBeLessThan(
      callType.indexOf("DROP FUNCTION cdr_rate_call(text, text, text, text)"),
    );
    expect(callType.indexOf("DROP FUNCTION cdr_rate_call(text, text, text, text)")).toBeLessThan(
      callType.indexOf("DROP FUNCTION cdr_call_geography(text, text)"),
    );
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
