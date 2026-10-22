import { describe, expect, it } from "vitest";
import { deferTraceCut } from "@/modules/smg-trace/cut-gate";

describe("deferTraceCut", () => {
  it("waits while the cut is pending and a purge or vacuum holds the tables", () => {
    expect(
      deferTraceCut({
        vacuum: false,
        purge: true,
        journalDone: false,
        hasCurrentLiveMark: false,
      }),
    ).toBe(true);
    expect(
      deferTraceCut({
        vacuum: true,
        purge: false,
        journalDone: true,
        hasCurrentLiveMark: false,
      }),
    ).toBe(true);
  });

  it("does not wait once the journal flag and the current live mark exist", () => {
    expect(
      deferTraceCut({
        vacuum: true,
        purge: true,
        journalDone: true,
        hasCurrentLiveMark: true,
      }),
    ).toBe(false);
  });

  it("does not wait when nothing else is deleting", () => {
    expect(
      deferTraceCut({
        vacuum: false,
        purge: false,
        journalDone: false,
        hasCurrentLiveMark: false,
      }),
    ).toBe(false);
  });
});
