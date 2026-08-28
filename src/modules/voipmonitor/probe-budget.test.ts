import { describe, expect, it } from "vitest";
import {
  ARCHIVE_RETRY_PROBE_BUDGET,
  LIVE_PROBE_BUDGET,
} from "@/modules/voipmonitor/constants";
import {
  effectiveProbeBudget,
  looksLikeResultCap,
  probeBudgetForLane,
  shouldFetchAnotherArchiveHour,
} from "@/modules/voipmonitor/probe-budget";

describe("probeBudgetForLane", () => {
  it("gives live a fixed cap", () => {
    expect(probeBudgetForLane("live", 0)).toBe(LIVE_PROBE_BUDGET);
    expect(probeBudgetForLane("live", 4)).toBe(LIVE_PROBE_BUDGET);
  });

  it("gives archive zero probes on the first pass", () => {
    expect(probeBudgetForLane("archive", 0)).toBe(0);
  });

  it("gives archive a retry budget after a prior attempt", () => {
    expect(probeBudgetForLane("archive", 1)).toBe(ARCHIVE_RETRY_PROBE_BUDGET);
  });
});

describe("effectiveProbeBudget", () => {
  it("skips probes when the hour fetch is empty", () => {
    expect(effectiveProbeBudget(32, 0, false)).toBe(0);
  });

  it("raises archive first-pass budget when the fetch looks incomplete", () => {
    expect(effectiveProbeBudget(0, 2000, true)).toBe(ARCHIVE_RETRY_PROBE_BUDGET);
  });

  it("keeps the requested budget when the fetch looks complete", () => {
    expect(effectiveProbeBudget(0, 800, false)).toBe(0);
    expect(effectiveProbeBudget(32, 800, false)).toBe(32);
  });
});

describe("shouldFetchAnotherArchiveHour", () => {
  it("always allows the first archive hour even after the deadline", () => {
    expect(shouldFetchAnotherArchiveHour(false, 100, 50)).toBe(true);
  });

  it("stops later archive hours after the deadline", () => {
    expect(shouldFetchAnotherArchiveHour(true, 100, 50)).toBe(false);
    expect(shouldFetchAnotherArchiveHour(true, 40, 50)).toBe(true);
  });
});

describe("looksLikeResultCap", () => {
  it("treats exact round pages as a possible cap", () => {
    expect(looksLikeResultCap(2000)).toBe(true);
    expect(looksLikeResultCap(1999)).toBe(false);
    expect(looksLikeResultCap(2001)).toBe(false);
  });
});
