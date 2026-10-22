import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRaw = vi.fn();
const findUnique = vi.fn();
const upsert = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    smgTraceCheckpoint: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      upsert: (...args: unknown[]) => upsert(...args),
    },
  },
}));

import { resetRadiusJournalOnce } from "@/modules/antifraud/journal-reset";

function sqlText(sql: unknown): string {
  if (!sql || typeof sql !== "object" || !("strings" in sql)) return "";
  return ((sql as { strings?: string[] }).strings ?? []).join("");
}

describe("resetRadiusJournalOnce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeRaw.mockResolvedValue(0);
    upsert.mockResolvedValue({});
  });

  it("deletes the journal once and writes the flag only after that statement", async () => {
    findUnique.mockResolvedValue(null);
    await expect(resetRadiusJournalOnce()).resolves.toBe(true);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const text = sqlText(executeRaw.mock.calls[0]?.[0]);
    expect(text).toBe("DELETE FROM radius_calls");
    expect(text).not.toContain("radius_ingest");
    expect(text).not.toContain("LIMIT");
    const deleteOrder = executeRaw.mock.invocationCallOrder[0] ?? 0;
    const flagOrder = upsert.mock.invocationCallOrder[0] ?? 0;
    expect(flagOrder).toBeGreaterThan(deleteOrder);
  });

  it("does not delete again when the flag is already done, even from an older version", async () => {
    findUnique.mockResolvedValue({ state: { done: true }, version: 1 });
    await expect(resetRadiusJournalOnce()).resolves.toBe(false);
    expect(executeRaw).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("does not write the flag when the delete fails", async () => {
    findUnique.mockResolvedValue(null);
    executeRaw.mockRejectedValue(new Error("disk"));
    await expect(resetRadiusJournalOnce()).rejects.toThrow("disk");
    expect(upsert).not.toHaveBeenCalled();
  });
});
