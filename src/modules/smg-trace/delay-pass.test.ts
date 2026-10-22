import { describe, expect, it } from "vitest";
import {
  AF_DELAY_REVISION,
  advanceDelayMark,
  openDelayMark,
} from "@/modules/smg-trace/delay-pass";
import { fillDelaySampleSql, integerArraySql } from "@/modules/smg-trace/delay-samples";

describe("delay mark", () => {
  it("starts a missing checkpoint and keeps a finished one", () => {
    expect(openDelayMark(null)).toEqual({ revision: AF_DELAY_REVISION, done: false });
    expect(openDelayMark({ revision: AF_DELAY_REVISION, done: true }).done).toBe(true);
  });

  it("restarts when the delay revision changes and ignores the label checkpoint", () => {
    expect(openDelayMark({ revision: AF_DELAY_REVISION - 1, done: true })).toEqual({
      revision: AF_DELAY_REVISION,
      done: false,
    });
    expect(openDelayMark({ revision: 2, cursor: "row", done: true }).done).toBe(false);
  });

  it("finishes only when the null batch is shorter than the page", () => {
    const open = openDelayMark(null);
    expect(advanceDelayMark(open, 200, 200)).toEqual({
      revision: AF_DELAY_REVISION,
      done: false,
    });
    expect(advanceDelayMark(open, 0, 200).done).toBe(true);
    expect(advanceDelayMark(open, 199, 200).done).toBe(true);
  });
});

describe("delay sample sql", () => {
  it("stores an empty parse as an empty array and does not overwrite a saved card", () => {
    expect(integerArraySql([]).strings.join("")).toContain("ARRAY[]::integer[]");
    expect(integerArraySql([]).values).toEqual([]);
    expect(integerArraySql([0, 12]).values).toEqual([0, 12]);
    const update = fillDelaySampleSql({ id: "row-1", dev: [0], prod: [], parking: [7] });
    expect(update.strings.join(" ")).toContain("af_ms_dev IS NULL");
    expect(update.values).toContain("row-1");
  });
});
