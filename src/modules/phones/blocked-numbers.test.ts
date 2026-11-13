import { beforeEach, describe, expect, it, vi } from "vitest";

const { findState, queryRaw } = vi.hoisted(() => ({
  findState: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    phoneImportState: {
      findUnique: (...args: unknown[]) => findState(...args),
    },
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
  },
}));

import {
  buildBlockedNumberIndex,
  loadBlockedNumbers,
  numberIsBlocked,
  resetBlockedNumberCacheForTests,
} from "@/modules/phones/blocked-numbers";

const STAMP = new Date("2026-11-06T00:00:00.000Z");

describe("blocked number index", () => {
  it("matches the catalog string, a 7/8 prefix, and a 10-digit national number", () => {
    const index = buildBlockedNumberIndex([" 73852222205 ", "100", ""]);
    expect(numberIsBlocked(index, "73852222205")).toBe(true);
    expect(numberIsBlocked(index, "83852222205")).toBe(true);
    expect(numberIsBlocked(index, "3852222205")).toBe(true);
    expect(numberIsBlocked(index, "+7 (385) 222-22-05")).toBe(true);
    expect(numberIsBlocked(index, "100")).toBe(true);
    expect(numberIsBlocked(index, "0100")).toBe(false);
    expect(numberIsBlocked(index, "0073852222205")).toBe(false);
    expect(numberIsBlocked(index, "")).toBe(false);
    expect(numberIsBlocked(index, "   ")).toBe(false);
    expect(numberIsBlocked(index, "74950000000")).toBe(false);
  });
});

describe("loadBlockedNumbers", () => {
  beforeEach(() => {
    findState.mockReset();
    queryRaw.mockReset();
    resetBlockedNumberCacheForTests();
  });

  it("reads the catalog once until the phone sync stamp changes", async () => {
    findState.mockResolvedValue({ lastSyncedAt: STAMP });
    queryRaw.mockResolvedValue([{ number: "73852222205" }]);
    const first = await loadBlockedNumbers();
    const second = await loadBlockedNumbers();
    expect(numberIsBlocked(first, "3852222205")).toBe(true);
    expect(numberIsBlocked(second, "100")).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    findState.mockResolvedValue({ lastSyncedAt: new Date("2026-11-07T00:00:00.000Z") });
    queryRaw.mockResolvedValue([{ number: "100" }]);
    const next = await loadBlockedNumbers();
    expect(numberIsBlocked(next, "100")).toBe(true);
    expect(numberIsBlocked(next, "73852222205")).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("returns an empty index when the catalog cannot be read and tries again", async () => {
    findState.mockRejectedValueOnce(new Error("db down"));
    const failed = await loadBlockedNumbers();
    expect(numberIsBlocked(failed, "73852222205")).toBe(false);

    findState.mockResolvedValue({ lastSyncedAt: STAMP });
    queryRaw.mockResolvedValue([{ number: "73852222205" }]);
    const loaded = await loadBlockedNumbers();
    expect(numberIsBlocked(loaded, "73852222205")).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("does not keep an empty index after a failed catalog query", async () => {
    findState.mockResolvedValue({ lastSyncedAt: STAMP });
    queryRaw.mockRejectedValueOnce(new Error("sql"));
    expect(numberIsBlocked(await loadBlockedNumbers(), "100")).toBe(false);

    queryRaw.mockResolvedValue([{ number: "100" }]);
    expect(numberIsBlocked(await loadBlockedNumbers(), "100")).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("shares one catalog read while the first is still running", async () => {
    findState.mockResolvedValue({ lastSyncedAt: STAMP });
    let release: (rows: Array<{ number: string }>) => void = () => {};
    let started!: () => void;
    const queryStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    queryRaw.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
          started();
        }),
    );
    const first = loadBlockedNumbers();
    const second = loadBlockedNumbers();
    await queryStarted;
    release([{ number: "100" }]);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(numberIsBlocked(a, "100")).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
