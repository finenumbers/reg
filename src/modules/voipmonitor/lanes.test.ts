import { describe, expect, it } from "vitest";
import { LIVE_PRIORITY_MS } from "@/modules/voipmonitor/constants";
import { laneCdrAtWhere, liveCutoffAt } from "@/modules/voipmonitor/lanes";

describe("laneCdrAtWhere", () => {
  const now = new Date("2026-08-29T12:00:00.000Z");
  const liveCutoff = liveCutoffAt(now);

  it("keeps a live hour entirely after the cutoff", () => {
    const hour = new Date("2026-08-29T10:00:00.000Z");
    const hourEnd = new Date("2026-08-29T11:00:00.000Z");
    const where = laneCdrAtWhere(hour, hourEnd, "live", now);
    expect(where.gte).toEqual(hour);
    expect(where.lt).toEqual(hourEnd);
    expect(where.gte.getTime()).toBeGreaterThanOrEqual(liveCutoff.getTime());
  });

  it("does not pull archive-aged rows from a live boundary hour", () => {
    const hour = new Date(liveCutoff.getTime() - 30 * 60 * 1000);
    const hourEnd = new Date(hour.getTime() + 60 * 60 * 1000);
    const where = laneCdrAtWhere(hour, hourEnd, "live", now);
    expect(where.gte).toEqual(liveCutoff);
    expect(where.lt).toEqual(hourEnd);
    expect(where.gte.getTime()).toBeGreaterThanOrEqual(liveCutoff.getTime());
  });

  it("does not pull live rows from an archive boundary hour", () => {
    const hour = new Date(liveCutoff.getTime() - 30 * 60 * 1000);
    const hourEnd = new Date(hour.getTime() + 60 * 60 * 1000);
    const where = laneCdrAtWhere(hour, hourEnd, "archive", now);
    expect(where.gte).toEqual(hour);
    expect(where.lt).toEqual(liveCutoff);
    expect(where.lt.getTime()).toBeLessThanOrEqual(liveCutoff.getTime());
  });

  it("keeps a fully archive hour below the cutoff", () => {
    const hour = new Date(now.getTime() - LIVE_PRIORITY_MS - 3 * 60 * 60 * 1000);
    const hourEnd = new Date(hour.getTime() + 60 * 60 * 1000);
    const where = laneCdrAtWhere(hour, hourEnd, "archive", now);
    expect(where.gte).toEqual(hour);
    expect(where.lt).toEqual(hourEnd);
    expect(where.lt.getTime()).toBeLessThanOrEqual(liveCutoff.getTime());
  });
});
