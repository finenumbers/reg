import { describe, expect, it } from "vitest";
import {
  cdrLabelWrite,
  cdrTagNorms,
  expandedTagSet,
  lockOrder,
  openCdrLabelMark,
  stampImportedCdr,
} from "@/modules/smg/cdr-labels";
import { NO_TRACE_LABELS } from "@/modules/smg/row-tokens";
import { AF_CATEGORY, AF_STATUS } from "@/modules/smg-trace/classify";
import { AF_LABEL_REVISION } from "@/modules/smg-trace/label-pass";

const TAG = "1100004f00000001";
const OTHER = "1100004f00000002";

describe("openCdrLabelMark", () => {
  it("accepts the current revision and rejects an older one", () => {
    expect(
      openCdrLabelMark({ revision: AF_LABEL_REVISION, done: true, cursor: "a" }),
    ).toEqual({
      revision: AF_LABEL_REVISION,
      done: true,
      cursor: "a",
    });
    expect(
      openCdrLabelMark({ revision: AF_LABEL_REVISION - 1, done: true, cursor: "a" }),
    ).toEqual({
      revision: AF_LABEL_REVISION,
      done: false,
      cursor: "",
    });
    expect(openCdrLabelMark(null).done).toBe(false);
  });
});

describe("cdrTagNorms", () => {
  it("keeps one real key in each field and drops a zero session", () => {
    expect(cdrTagNorms(` ${TAG} `, "1100004f000000000000000000000000")).toEqual({
      uniqueTagNorm: TAG,
      radiusSessionNorm: "",
    });
    expect(cdrTagNorms(TAG, TAG)).toEqual({
      uniqueTagNorm: TAG,
      radiusSessionNorm: TAG,
    });
    expect(cdrTagNorms("tag-1", "")).toEqual({
      uniqueTagNorm: "",
      radiusSessionNorm: "",
    });
  });
});

describe("stampImportedCdr", () => {
  it("stores no-data when the row has no key and leaves a keyed row unlabeled", () => {
    const plain: {
      uniqueTag: string;
      radiusSessionId: string;
      uniqueTagNorm?: string;
      radiusSessionNorm?: string;
      afCategory?: string | null;
      afStatus?: string | null;
    } = { uniqueTag: "tag-1", radiusSessionId: "" };
    expect(stampImportedCdr(plain)).toEqual([]);
    expect(plain).toMatchObject({
      uniqueTagNorm: "",
      radiusSessionNorm: "",
      afCategory: NO_TRACE_LABELS.category,
      afStatus: NO_TRACE_LABELS.status,
    });

    const keyed: typeof plain = { uniqueTag: TAG, radiusSessionId: OTHER };
    expect(stampImportedCdr(keyed)).toEqual([OTHER, TAG].sort());
    expect(keyed.uniqueTagNorm).toBe(TAG);
    expect(keyed.radiusSessionNorm).toBe(OTHER);
    expect(keyed.afCategory).toBeUndefined();
  });
});

describe("lockOrder", () => {
  it("sorts unique tags so two writers take them in the same order", () => {
    expect(lockOrder([TAG, OTHER, TAG, ""])).toEqual([OTHER, TAG].sort());
  });
});

describe("expandedTagSet", () => {
  it("asks for the partner key and stops when both are locked", () => {
    const row = { uniqueTagNorm: TAG, radiusSessionNorm: OTHER };
    const first = expandedTagSet([TAG], [row]);
    expect(first).toEqual([OTHER, TAG].sort());
    expect(expandedTagSet(first!, [row])).toBeNull();
  });
});

describe("cdrLabelWrite", () => {
  it("does not replace a pair that appeared after a null-only read", () => {
    expect(
      cdrLabelWrite(
        true,
        "cdr-1",
        { category: AF_CATEGORY.passed, status: AF_STATUS.firstTry },
        { category: NO_TRACE_LABELS.category, status: NO_TRACE_LABELS.status },
      ),
    ).toBeNull();
  });

  it("fills a null pair only while it is still null", () => {
    expect(
      cdrLabelWrite(
        true,
        "cdr-1",
        { category: null, status: null },
        { category: AF_CATEGORY.passed, status: AF_STATUS.firstTry },
      ),
    ).toEqual({
      where: { id: "cdr-1", afCategory: null },
      data: { afCategory: AF_CATEGORY.passed, afStatus: AF_STATUS.firstTry },
    });
  });

  it("overwrites a stored pair when the card changed", () => {
    expect(
      cdrLabelWrite(
        false,
        "cdr-1",
        { category: AF_CATEGORY.waiting, status: AF_STATUS.unknown },
        { category: AF_CATEGORY.passed, status: AF_STATUS.firstTry },
      )?.where,
    ).toEqual({ id: "cdr-1" });
  });
});
