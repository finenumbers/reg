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

  it("deletes the journal and writes the flag in one statement", async () => {
    findUnique.mockResolvedValue(null);
    await expect(resetRadiusJournalOnce()).resolves.toBe(true);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const text = sqlText(executeRaw.mock.calls[0]?.[0]);
    expect(text).toContain("DELETE FROM radius_calls");
    expect(text).toContain("INSERT INTO smg_trace_checkpoints");
    expect(text).toContain("ON CONFLICT (device_ip, file_key)");
    expect(text).toContain('{"done":true}');
    expect(text).not.toContain("radius_ingest");
    expect(text).not.toContain("LIMIT");
    expect(upsert).not.toHaveBeenCalled();
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
