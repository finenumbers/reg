import { describe, expect, it, afterEach } from "vitest";
import {
  beginStor,
  completeStor,
  failStor,
  isStorBusy,
  resetStorGateForTests,
  storCompletedSize,
} from "@/modules/traffic/stor-gate";

describe("STOR gate", () => {
  afterEach(() => {
    resetStorGateForTests();
  });

  it("ignores a finish from an older generation", () => {
    const path = "/tmp/cdr/20261014_035348";
    const first = beginStor(path);
    const second = beginStor(path);
    completeStor(path, first, 10);
    expect(isStorBusy(path)).toBe(true);
    expect(storCompletedSize(path)).toBeUndefined();
    completeStor(path, second, 40);
    expect(isStorBusy(path)).toBe(false);
    expect(storCompletedSize(path)).toBe(40);
  });

  it("drops a failed write after the settle window", () => {
    const path = "/tmp/cdr/20261014_035349";
    const generation = beginStor(path);
    failStor(path, generation, 1_000);
    expect(isStorBusy(path, 1_000)).toBe(true);
    expect(isStorBusy(path, 1_000 + 2_000)).toBe(false);
  });
});
