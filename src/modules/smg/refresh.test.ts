import { describe, expect, it } from "vitest";
import { decideSmgRefresh } from "@/modules/smg/refresh";

describe("decideSmgRefresh", () => {
  it("does not reload on the first poll and stores the cursor", () => {
    expect(
      decideSmgRefresh({
        ok: true,
        since: null,
        cursor: "job-1",
        changed: false,
      }),
    ).toEqual({ reload: false, since: "job-1" });
  });

  it("does not reload the first poll even if the server reports a change", () => {
    expect(
      decideSmgRefresh({
        ok: true,
        since: null,
        cursor: "job-1",
        changed: true,
      }),
    ).toEqual({ reload: false, since: "job-1" });
  });

  it("advances the cursor without reloading when the job inserted nothing", () => {
    expect(
      decideSmgRefresh({
        ok: true,
        since: "job-1",
        cursor: "job-2",
        changed: false,
      }),
    ).toEqual({ reload: false, since: "job-2" });
  });

  it("reloads when a later job inserted rows or bad lines", () => {
    expect(
      decideSmgRefresh({
        ok: true,
        since: "job-1",
        cursor: "job-2",
        changed: true,
      }),
    ).toEqual({ reload: true, since: "job-2" });
  });

  it("keeps the cursor when the status request fails", () => {
    expect(
      decideSmgRefresh({
        ok: false,
        since: "job-1",
        cursor: "job-2",
        changed: true,
      }),
    ).toEqual({ reload: false, since: "job-1" });
  });

  it("reloads an empty history when a later import wrote rows", () => {
    expect(
      decideSmgRefresh({
        ok: true,
        since: null,
        cursor: "job-1",
        changed: true,
        baselineEmpty: true,
      }),
    ).toEqual({ reload: true, since: "job-1" });
  });

  it("keeps an empty history in place when the import wrote nothing", () => {
    expect(
      decideSmgRefresh({
        ok: true,
        since: null,
        cursor: "job-1",
        changed: false,
        baselineEmpty: true,
      }),
    ).toEqual({ reload: false, since: "job-1" });
  });

  it("keeps the previous cursor when the response has none", () => {
    expect(
      decideSmgRefresh({
        ok: true,
        since: "job-1",
        cursor: null,
        changed: false,
      }),
    ).toEqual({ reload: false, since: "job-1" });
  });
});
