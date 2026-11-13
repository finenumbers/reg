import { beforeEach, describe, expect, it } from "vitest";
import {
  acquireOprsFacetLane,
  OprsFacetLaneAbort,
  releaseOprsFacetLane,
  resetOprsFacetLaneForTests,
} from "@/modules/oprs/facet-lane";

describe("OPRS facet lane", () => {
  beforeEach(() => {
    resetOprsFacetLaneForTests();
  });

  it("holds the third read until one slot is released", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const third = new AbortController();
    await acquireOprsFacetLane(first.signal);
    await acquireOprsFacetLane(second.signal);
    let started = false;
    const waiting = acquireOprsFacetLane(third.signal).then(() => {
      started = true;
    });
    await Promise.resolve();
    expect(started).toBe(false);
    releaseOprsFacetLane();
    await waiting;
    expect(started).toBe(true);
    releaseOprsFacetLane();
    releaseOprsFacetLane();
  });

  it("does not give a slot to a read that left before it started", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const leaving = new AbortController();
    const next = new AbortController();
    await acquireOprsFacetLane(first.signal);
    await acquireOprsFacetLane(second.signal);
    const abandoned = acquireOprsFacetLane(leaving.signal);
    leaving.abort();
    await expect(abandoned).rejects.toBeInstanceOf(OprsFacetLaneAbort);

    let started = false;
    const waiting = acquireOprsFacetLane(next.signal).then(() => {
      started = true;
    });
    await Promise.resolve();
    expect(started).toBe(false);
    releaseOprsFacetLane();
    await waiting;
    expect(started).toBe(true);
    releaseOprsFacetLane();
    releaseOprsFacetLane();
  });
});
