import { describe, expect, it } from "vitest";
import {
  MISSING_BILLING_LABEL,
  MISSING_PSTN_LABEL,
  descriptionOrMissing,
  failOpenEnrichStages,
  isFinishedEnrichJob,
  isResumableEnrichJob,
  pstnOrMissing,
} from "@/modules/enrich/types";

describe("enrich field rules", () => {
  it("uses Нет в биллинге when description is missing", () => {
    expect(descriptionOrMissing(undefined)).toBe(MISSING_BILLING_LABEL);
    expect(descriptionOrMissing("  ")).toBe(MISSING_BILLING_LABEL);
    expect(descriptionOrMissing("Шлюз")).toBe("Шлюз");
  });

  it("marks PSTN miss independently of description", () => {
    expect(pstnOrMissing(undefined).missing).toBe(true);
    expect(pstnOrMissing({ found: false, operator: null, garTerritory: null })).toEqual({
      operator: MISSING_PSTN_LABEL,
      geography: MISSING_PSTN_LABEL,
      missing: true,
    });
    expect(
      pstnOrMissing({
        found: true,
        operator: "МТС",
        garTerritory: "Кемерово",
      }),
    ).toEqual({
      operator: "МТС",
      geography: "Кемерово",
      missing: false,
    });
  });
});

describe("enrich job lifetime", () => {
  it("resumes only queued or running jobs", () => {
    expect(isResumableEnrichJob({ status: "queued" })).toBe(true);
    expect(isResumableEnrichJob({ status: "running" })).toBe(true);
    expect(isResumableEnrichJob({ status: "completed" })).toBe(false);
    expect(isResumableEnrichJob({ status: "failed" })).toBe(false);
    expect(isResumableEnrichJob(null)).toBe(false);
  });

  it("treats completed and failed as finished", () => {
    expect(isFinishedEnrichJob({ status: "completed" })).toBe(true);
    expect(isFinishedEnrichJob({ status: "failed" })).toBe(true);
    expect(isFinishedEnrichJob({ status: "running" })).toBe(false);
    expect(isFinishedEnrichJob(null)).toBe(false);
  });

  it("fails open stages and keeps done/error", () => {
    expect(
      failOpenEnrichStages(
        [
          { id: "parse", label: "p", status: "done" },
          { id: "phones", label: "ph", status: "running" },
          { id: "pstn", label: "pstn", status: "pending" },
        ],
        "stop",
      ),
    ).toEqual([
      { id: "parse", label: "p", status: "done" },
      { id: "phones", label: "ph", status: "error", detail: "stop" },
      { id: "pstn", label: "pstn", status: "error", detail: "stop" },
    ]);
  });
});
