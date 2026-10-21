import { describe, expect, it } from "vitest";
import { AF_LABEL_REVISION, advanceLabelMark, openLabelMark } from "@/modules/smg-trace/label-pass";

describe("stored antifraud label revision", () => {
  it("starts a pass when the checkpoint is missing or from an older revision", () => {
    expect(openLabelMark(null)).toEqual({ revision: AF_LABEL_REVISION, cursor: "", done: false });
    expect(openLabelMark({ revision: 1, cursor: "abc", done: true })).toEqual({
      revision: AF_LABEL_REVISION,
      cursor: "",
      done: false,
    });
  });

  it("keeps the cursor of the current revision", () => {
    expect(openLabelMark({ revision: AF_LABEL_REVISION, cursor: "row-9", done: false })).toEqual({
      revision: AF_LABEL_REVISION,
      cursor: "row-9",
      done: false,
    });
    expect(openLabelMark({ revision: AF_LABEL_REVISION, cursor: "row-9", done: true }).done).toBe(true);
  });

  it("stops after a short batch and continues after a full one", () => {
    const mark = openLabelMark(null);
    const full = Array.from({ length: 200 }, (_, index) => `id-${index}`);
    const mid = advanceLabelMark(mark, full, 200);
    expect(mid).toEqual({ revision: AF_LABEL_REVISION, cursor: "id-199", done: false });
    const tail = advanceLabelMark(mid, ["id-200"], 200);
    expect(tail).toEqual({ revision: AF_LABEL_REVISION, cursor: "id-200", done: true });
    expect(advanceLabelMark(mark, [], 200)).toEqual({
      revision: AF_LABEL_REVISION,
      cursor: "",
      done: true,
    });
  });
});
