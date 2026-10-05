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

const CATEGORY_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261005192000_cdr_call_class_extra/migration.sql",
);
const STATUS_MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261005181000_cdr_call_class/migration.sql",
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
      classifyCallCategory(known, known, "Service_Check", "Redirect_1", unregistered),
    ).toBe(CALL_CATEGORY.redirect);
    expect(
      classifyCallCategory(
        known,
        known,
        "Service_Check",
        "Service_Redirect_",
        routeError,
      ),
    ).toBe(CALL_CATEGORY.check);
    expect(classifyCallCategory(known, known, "gw", "RedirectX", "")).toBe(
      CALL_CATEGORY.internal,
    );
    expect(classifyCallCategory(known, known, "Service_Check_1", "gw", "")).toBe(
      CALL_CATEGORY.internal,
    );
    expect(classifyCallCategory(known, known, "gw", "gw", unregistered)).toBe(
      CALL_CATEGORY.unregistered,
    );
    expect(classifyCallCategory(known, known, PARKING_DST, "gw", routeError)).toBe(
      CALL_CATEGORY.routeError,
    );
    expect(
      classifyCallCategory(known, known, "Service_Check", " Redirect_", unregistered),
    ).toBe(CALL_CATEGORY.check);
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
    expect(readFileSync(CATEGORY_MIGRATION, "utf8")).toContain(
      renderCallCategoryCaseSql(),
    );
    expect(readFileSync(STATUS_MIGRATION, "utf8")).toContain(renderCallStatusCaseSql());
  });
});
