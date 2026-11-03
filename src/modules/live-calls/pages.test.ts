import { describe, expect, it } from "vitest";
import { decideNextPage, MAX_CALL_PAGES } from "@/modules/live-calls/pages";

const pageSize = 2000;

function ids(values: string[]): Set<string> {
  return new Set(values);
}

describe("decideNextPage", () => {
  it("stops on a short page and keeps those rows", () => {
    expect(
      decideNextPage({
        pageIndex: 0,
        rowCount: 3,
        pageIds: ids(["a"]),
        previousIds: null,
        pageSize,
        maxPages: MAX_CALL_PAGES,
      }),
    ).toEqual({ action: "stop", append: true, truncated: false });
  });

  it("continues after a full page and stops when the next page repeats it", () => {
    const first = ids(["a", "b"]);
    expect(
      decideNextPage({
        pageIndex: 0,
        rowCount: pageSize,
        pageIds: first,
        previousIds: null,
        pageSize,
        maxPages: MAX_CALL_PAGES,
      }),
    ).toEqual({ action: "continue", append: true, truncated: false });
    expect(
      decideNextPage({
        pageIndex: 1,
        rowCount: pageSize,
        pageIds: first,
        previousIds: first,
        pageSize,
        maxPages: MAX_CALL_PAGES,
      }),
    ).toEqual({ action: "duplicate", append: false, truncated: true });
  });

  it("appends a different full page and caps the fifth full page", () => {
    expect(
      decideNextPage({
        pageIndex: 1,
        rowCount: pageSize,
        pageIds: ids(["c"]),
        previousIds: ids(["a"]),
        pageSize,
        maxPages: MAX_CALL_PAGES,
      }).action,
    ).toBe("continue");
    expect(
      decideNextPage({
        pageIndex: MAX_CALL_PAGES - 1,
        rowCount: pageSize,
        pageIds: ids(["z"]),
        previousIds: ids(["y"]),
        pageSize,
        maxPages: MAX_CALL_PAGES,
      }),
    ).toEqual({ action: "cap", append: true, truncated: true });
  });

  it("does not ask for another page when the answer is already larger than the page", () => {
    expect(
      decideNextPage({
        pageIndex: 0,
        rowCount: pageSize + 1,
        pageIds: ids(["a"]),
        previousIds: null,
        pageSize,
        maxPages: MAX_CALL_PAGES,
      }),
    ).toEqual({ action: "stop", append: true, truncated: true });
  });
});
