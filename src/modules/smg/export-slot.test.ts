import { describe, expect, it } from "vitest";
import { smgExportSlotHeld } from "@/modules/smg/export-job";

const KEEP_MS = 15 * 60 * 1000;

describe("smgExportSlotHeld", () => {
  const now = 1_000_000;

  it("holds the slot while any build is running", () => {
    expect(
      smgExportSlotHeld(
        { status: "running", actorUserId: "owner", createdAt: now },
        "owner",
        now,
      ),
    ).toBe(true);
    expect(
      smgExportSlotHeld(
        { status: "running", actorUserId: "owner", createdAt: now },
        "other",
        now,
      ),
    ).toBe(true);
  });

  it("holds a fresh file that belongs to someone else", () => {
    expect(
      smgExportSlotHeld(
        { status: "ready", actorUserId: "owner", createdAt: now - 1000 },
        "other",
        now,
      ),
    ).toBe(true);
  });

  it("lets the owner replace their own file and anyone replace an error or a stale file", () => {
    expect(
      smgExportSlotHeld(
        { status: "ready", actorUserId: "owner", createdAt: now - 1000 },
        "owner",
        now,
      ),
    ).toBe(false);
    expect(
      smgExportSlotHeld(
        { status: "error", actorUserId: "owner", createdAt: now - 1000 },
        "other",
        now,
      ),
    ).toBe(false);
    expect(
      smgExportSlotHeld(
        { status: "ready", actorUserId: "owner", createdAt: now - KEEP_MS },
        "other",
        now,
      ),
    ).toBe(false);
    expect(smgExportSlotHeld(null, "other", now)).toBe(false);
  });
});
