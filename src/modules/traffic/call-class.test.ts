import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import { PARKING_DST } from "@/modules/stats/classify";
import {
  CALL_CATEGORY,
  CALL_STATUS,
  classifyCallCategory,
  classifyCallGeography,
  classifyCallStatus,
  classifyExportStatus,
  renderCallCategoryCaseSql,
  renderCallStatusCaseSql,
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

  it("classifies direction when the terminator is not parking", () => {
    expect(
      classifyCallCategory(known, unknown, "PSTN_A", "", "", "", nsk, moscow, cityRates),
    ).toBe(CALL_CATEGORY.outgoingIntercity);
    expect(classifyCallCategory(unknown, known, "PSTN_A")).toBe(CALL_CATEGORY.incoming);
    expect(
      classifyCallCategory(known, known, "PSTN_A", "", "", "", nsk, nskOther, cityRates),
    ).toBe(CALL_CATEGORY.outgoingLocal);
    expect(classifyCallCategory("", "", "PSTN_A")).toBe(CALL_CATEGORY.error);
    expect(classifyCallCategory(unknown, unknown, "PSTN_A")).toBe(CALL_CATEGORY.error);
  });

  it("splits a known side A by numbers and one city direction", () => {
    expect(classifyCallGeography(nsk, nskOther, cityRates)).toBe("local");
    expect(classifyCallGeography(nsk, moscow, cityRates)).toBe("intercity");
    expect(classifyCallGeography(nsk, mobile, cityRates)).toBe("intercity");
    expect(classifyCallGeography(nsk, "4420712345", cityRates)).toBe("international");
    expect(classifyCallGeography("100", nsk, cityRates)).toBe("intercity");
    expect(classifyCallGeography(nsk, nskOther, [])).toBe("intercity");
    expect(
      classifyCallGeography(nsk, nskOther, [
        { direction: "Новосибирск", abc: "7383", sortIndex: 0 },
      ]),
    ).toBe("intercity");
    expect(
      classifyCallCategory(
        known,
        known,
        "PSTN_A",
        "",
        "",
        "",
        nsk,
        "4420712345",
        cityRates,
      ),
    ).toBe(CALL_CATEGORY.outgoingInternational);
    expect(
      classifyCallCategory(
        known,
        unknown,
        PARKING_DST,
        "",
        "",
        "",
        nsk,
        nskOther,
        cityRates,
      ),
    ).toBe(CALL_CATEGORY.parkingLocal);
    expect(
      classifyCallCategory(known, known, PARKING_DST, "", "", "", nsk, moscow, cityRates),
    ).toBe(CALL_CATEGORY.parkingIntercity);
    expect(
      classifyCallCategory(
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
    ).toBe(CALL_CATEGORY.parkingInternational);
  });

  it("classifies parking from the exact terminating device", () => {
    expect(classifyCallCategory(unknown, unknown, PARKING_DST)).toBe(
      CALL_CATEGORY.phantom,
    );
    expect(classifyCallCategory("", "", PARKING_DST)).toBe(CALL_CATEGORY.phantom);
    expect(classifyCallCategory(unknown, known, PARKING_DST)).toBe(
      CALL_CATEGORY.incomingParking,
    );
    expect(
      classifyCallCategory(
        known,
        unknown,
        PARKING_DST,
        "",
        "",
        "",
        nsk,
        moscow,
        cityRates,
      ),
    ).toBe(CALL_CATEGORY.parkingIntercity);
    expect(
      classifyCallCategory(
        known,
        known,
        PARKING_DST,
        "",
        "",
        "",
        mobile,
        mobile,
        cityRates,
      ),
    ).toBe(CALL_CATEGORY.parkingIntercity);
    expect(classifyCallCategory(known, known, "Service_Parking_1")).toBe(
      CALL_CATEGORY.outgoingInternational,
    );
    expect(classifyCallCategory(known, known, " Service_Parking")).toBe(
      CALL_CATEGORY.outgoingInternational,
    );
  });

  it("prefers redirect, check, and disconnect codes over side direction", () => {
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
    ).toBe(CALL_CATEGORY.redirect);
    expect(
      classifyCallCategory(known, known, "gw", "Redirect_1", "", "Service_Check"),
    ).toBe(CALL_CATEGORY.redirect);
    expect(classifyCallCategory(known, known, "gw", "gw", "", "Service_Check")).toBe(
      CALL_CATEGORY.check,
    );
    expect(classifyCallCategory("Тест 1", known, PARKING_DST, "gw", unregistered)).toBe(
      CALL_CATEGORY.check,
    );
    expect(classifyCallCategory(known, "Тест ", "gw", "gw", routeError)).toBe(
      CALL_CATEGORY.check,
    );
    expect(classifyCallCategory(known, known, "Service_Check", "gw", "")).toBe(
      CALL_CATEGORY.outgoingInternational,
    );
    expect(classifyCallCategory(known, known, "gw", "RedirectX", "")).toBe(
      CALL_CATEGORY.outgoingInternational,
    );
    expect(classifyCallCategory(known, known, "gw", "gw", "", "Service_Check_1")).toBe(
      CALL_CATEGORY.outgoingInternational,
    );
    expect(classifyCallCategory(known, known, "gw", "gw", "", " Service_Check")).toBe(
      CALL_CATEGORY.outgoingInternational,
    );
    expect(classifyCallCategory(known, known, "gw", "gw", "", "Service_Check ")).toBe(
      CALL_CATEGORY.outgoingInternational,
    );
    expect(classifyCallCategory("Тест", known, "gw")).toBe(
      CALL_CATEGORY.outgoingInternational,
    );
    expect(classifyCallCategory("Тест_1", known, "gw")).toBe(
      CALL_CATEGORY.outgoingInternational,
    );
    expect(classifyCallCategory("Тестовый", known, "gw")).toBe(
      CALL_CATEGORY.outgoingInternational,
    );
    expect(classifyCallCategory(" Тест 1", known, "gw")).toBe(
      CALL_CATEGORY.outgoingInternational,
    );
    expect(classifyCallCategory("тест 1", known, "gw")).toBe(
      CALL_CATEGORY.outgoingInternational,
    );
    expect(classifyCallCategory(known, known, "gw", "gw", unregistered)).toBe(
      CALL_CATEGORY.unregistered,
    );
    expect(classifyCallCategory(known, known, PARKING_DST, "gw", routeError)).toBe(
      CALL_CATEGORY.routeError,
    );
  });
});

describe("classifyCallStatus", () => {
  it("treats only an empty string as failed", () => {
    expect(classifyCallStatus("")).toBe(CALL_STATUS.failed);
    expect(classifyCallStatus("0")).toBe(CALL_STATUS.success);
    expect(classifyCallStatus("24383")).toBe(CALL_STATUS.success);
    expect(classifyExportStatus(undefined)).toBe(CALL_STATUS.success);
    expect(classifyExportStatus("")).toBe(CALL_STATUS.failed);
  });
});

describe("call class SQL", () => {
  it("is the function body stored in the migration", () => {
    const geography = readFileSync(CHECK_MIGRATION, "utf8");
    const renamed = readFileSync(LABEL_RENAME_MIGRATION, "utf8");
    const labels = readFileSync(LABEL_MIGRATION, "utf8");
    expect(renamed).toContain(renderCallCategoryCaseSql());
    expect(renamed).toContain("category IN ('Местный', 'Местный (П)')");
    expect(renamed).toContain("'Местный звонок'");
    expect(renamed).not.toContain("'Исходящий местный'");
    expect(renamed).not.toContain("DROP FUNCTION");
    expect(readFileSync(FAILED_PLURAL_MIGRATION, "utf8")).toContain(
      renderCallStatusCaseSql(),
    );
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
});
