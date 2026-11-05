import { describe, expect, it } from "vitest";
import {
  GROUPS_RESCHEDULE_DELAY_SEC,
  GROUPS_SYNC_INTERVAL_SEC,
  PHONES_RESCHEDULE_DELAY_SEC,
  PHONES_SYNC_INTERVAL_SEC,
  REGS_POLL_INTERVAL_SEC,
  REGS_RESCHEDULE_DELAY_SEC,
} from "@/modules/jobs/export-cadence";

function ticks(first: number, period: number, count: number): number[] {
  return Array.from({ length: count }, (_, n) => first + n * period);
}

function closest(left: number[], right: number[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const a of left) {
    for (const b of right) best = Math.min(best, Math.abs(a - b));
  }
  return best;
}

describe("reschedule delays", () => {
  it("keeps the next twenty ticks at least 15 seconds apart", () => {
    const regs = ticks(REGS_RESCHEDULE_DELAY_SEC, REGS_POLL_INTERVAL_SEC, 20);
    const phones = ticks(PHONES_RESCHEDULE_DELAY_SEC, PHONES_SYNC_INTERVAL_SEC, 20);
    const groups = ticks(GROUPS_RESCHEDULE_DELAY_SEC, GROUPS_SYNC_INTERVAL_SEC, 20);
    expect(closest(regs, phones)).toBeGreaterThanOrEqual(15);
    expect(closest(regs, groups)).toBeGreaterThanOrEqual(15);
    expect(closest(phones, groups)).toBeGreaterThanOrEqual(15);
  });
});
