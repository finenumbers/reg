import { describe, expect, it } from "vitest";
import { acceptOprsPage, appendOprsItems } from "@/modules/oprs/page-state";

describe("oprs page glue", () => {
  it("drops a page from another snapshot and keeps a matching one", () => {
    expect(acceptOprsPage(true, "old", "new")).toBe(true);
    expect(acceptOprsPage(false, "same", "same")).toBe(true);
    expect(acceptOprsPage(false, "open", "other")).toBe(false);
    expect(acceptOprsPage(false, null, "other")).toBe(false);
  });

  it("appends unseen ids and leaves a duplicate page unchanged", () => {
    const prev = [{ id: "a" }, { id: "b" }];
    expect(appendOprsItems(prev, [{ id: "b" }, { id: "c" }])).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
    const same = appendOprsItems(prev, [{ id: "a" }]);
    expect(same).toBe(prev);
  });
});
