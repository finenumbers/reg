import { describe, expect, it } from "vitest";
import { reduceStampWatch } from "@/hooks/stamp-watch";

describe("reduceStampWatch", () => {
  it("baselines an unprimed watch without reloading", () => {
    const result = reduceStampWatch(
      { stamp: undefined, pending: false },
      { ok: true, stamp: "a" },
    );
    expect(result.reload).toBe(false);
    expect(result.next).toEqual({ stamp: "a", pending: false });
  });

  it("reloads when a primed stamp moves", () => {
    const result = reduceStampWatch(
      { stamp: "a", pending: false },
      { ok: true, stamp: "b" },
    );
    expect(result.reload).toBe(true);
    expect(result.next.pending).toBe(false);
  });

  it("keeps a paused change and reloads it on the next idle tick", () => {
    const held = reduceStampWatch(
      { stamp: "a", pending: false },
      { ok: true, stamp: "b" },
      { paused: true },
    );
    expect(held.reload).toBe(false);
    expect(held.next.pending).toBe(true);

    const released = reduceStampWatch(held.next, { ok: true, stamp: "b" });
    expect(released.reload).toBe(true);
    expect(released.next).toEqual({ stamp: "b", pending: false });
  });

  it("leaves the watch in place when the status read fails", () => {
    const state = { stamp: "a", pending: true };
    expect(reduceStampWatch(state, { ok: false })).toEqual({ reload: false, next: state });
  });
});
