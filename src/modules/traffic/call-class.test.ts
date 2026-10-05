import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import { PARKING_DST } from "@/modules/stats/classify";
import {
  CALL_CATEGORY,
  CALL_STATUS,
  classifyCallCategory,
  classifyCallStatus,
  classifyExportStatus,
  renderCallCategoryCaseSql,
  renderCallStatusCaseSql,
} from "@/modules/traffic/call-class";

const LABEL_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261005211500_cdr_call_class_labels/migration.sql",
);
const CHECK_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261005222000_cdr_check_dial_and_sides/migration.sql",
);

describe("classifyCallCategory", () => {
  const known = "Офис";
  const unknown = MISSING_BILLING_LABEL;

  it("classifies direction when the terminator is not parking", () => {
    expect(classifyCallCategory(known, unknown, "PSTN_A")).toBe(CALL_CATEGORY.outgoing);
    expect(classifyCallCategory(unknown, known, "PSTN_A")).toBe(CALL_CATEGORY.incoming);
    expect(classifyCallCategory(known, known, "PSTN_A")).toBe(CALL_CATEGORY.internal);
    expect(classifyCallCategory("", "", "PSTN_A")).toBe(CALL_CATEGORY.error);
    expect(classifyCallCategory(unknown, unknown, "PSTN_A")).toBe(CALL_CATEGORY.error);
  });

  it("classifies parking from the exact terminating device", () => {
    expect(classifyCallCategory(unknown, unknown, PARKING_DST)).toBe(
      CALL_CATEGORY.phantom,
    );
    expect(classifyCallCategory("", "", PARKING_DST)).toBe(CALL_CATEGORY.phantom);
    expect(classifyCallCategory(unknown, known, PARKING_DST)).toBe(
      CALL_CATEGORY.incomingParking,
    );
    expect(classifyCallCategory(known, unknown, PARKING_DST)).toBe(
      CALL_CATEGORY.outgoingParking,
    );
    expect(classifyCallCategory(known, known, PARKING_DST)).toBe(
      CALL_CATEGORY.outgoingParking,
    );
    expect(classifyCallCategory(known, known, "Service_Parking_1")).toBe(
      CALL_CATEGORY.internal,
    );
    expect(classifyCallCategory(known, known, " Service_Parking")).toBe(
      CALL_CATEGORY.internal,
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
      CALL_CATEGORY.internal,
    );
    expect(classifyCallCategory(known, known, "gw", "RedirectX", "")).toBe(
      CALL_CATEGORY.internal,
    );
    expect(classifyCallCategory(known, known, "gw", "gw", "", "Service_Check_1")).toBe(
      CALL_CATEGORY.internal,
    );
    expect(classifyCallCategory(known, known, "gw", "gw", "", " Service_Check")).toBe(
      CALL_CATEGORY.internal,
    );
    expect(classifyCallCategory(known, known, "gw", "gw", "", "Service_Check ")).toBe(
      CALL_CATEGORY.internal,
    );
    expect(classifyCallCategory("Тест", known, "gw")).toBe(CALL_CATEGORY.internal);
    expect(classifyCallCategory("Тест_1", known, "gw")).toBe(CALL_CATEGORY.internal);
    expect(classifyCallCategory("Тестовый", known, "gw")).toBe(CALL_CATEGORY.internal);
    expect(classifyCallCategory(" Тест 1", known, "gw")).toBe(CALL_CATEGORY.internal);
    expect(classifyCallCategory("тест 1", known, "gw")).toBe(CALL_CATEGORY.internal);
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
    const sql = readFileSync(CHECK_MIGRATION, "utf8");
    expect(sql).toContain(renderCallCategoryCaseSql());
    expect(readFileSync(LABEL_MIGRATION, "utf8")).toContain(renderCallStatusCaseSql());
    expect(sql).toContain("NEW.dp_name");
    expect(sql).toContain(
      "DROP FUNCTION cdr_call_category(text, text, text, text, text);",
    );
    expect(sql).not.toContain("CASCADE");
  });
});
