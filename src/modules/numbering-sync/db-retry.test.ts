import { describe, expect, it } from "vitest";
import { isLockTimeout, isStatementTimeout, resplitShouldWait } from "@/modules/numbering-sync/db-retry";
import { SyncBusy } from "@/modules/numbering-sync/errors";
import { claimFailureIsBusy } from "@/modules/numbering-sync/service";

describe("numbering database retries", () => {
  it("treats a lock timeout as busy and does not retry a statement timeout", () => {
    const locked = { code: "55P03", message: "canceling statement due to lock timeout" };
    expect(isLockTimeout(locked)).toBe(true);
    expect(claimFailureIsBusy(locked)).toBe(true);
    expect(isStatementTimeout({ code: "57014" })).toBe(true);
    expect(resplitShouldWait({ code: "57014" }, 0, 0)).toBe(false);
  });

  it("waits on a live stage and stops after an hour", () => {
    const busy = new SyncBusy();
    expect(resplitShouldWait(busy, 1_000, 0)).toBe(true);
    expect(resplitShouldWait(busy, 60 * 60 * 1000, 0)).toBe(false);
    expect(resplitShouldWait(new Error("syntax"), 0, 0)).toBe(false);
  });
});
