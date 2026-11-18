import { describe, expect, it } from "vitest";
import { parseOprsFacetSearch, parseOprsListSearch } from "@/modules/oprs/query";
import { OprsQueryError } from "@/modules/oprs/where";
import { buildOprsFacetsUrl, buildOprsListUrl } from "@/modules/oprs/api";
import { buildTrafficListUrl } from "@/modules/traffic/api-client";

describe("oprs search parser", () => {
  it("refuses a cursor without a snapshot", () => {
    const params = new URLSearchParams({ cursorDate: "2026-11-01 00:00:00", cursorId: "a" });
    expect(() => parseOprsListSearch(params)).toThrow(OprsQueryError);
  });

  it("reads a seconds cursor, including a blank duration", () => {
    const params = new URLSearchParams({
      durationSort: "desc",
      timeSort: "asc",
      cursorElapsed: "",
      cursorId: "cdr-9",
      snapshot: "2026-11-13T00:00:00.000Z",
    });
    const parsed = parseOprsListSearch(params);
    expect(parsed.timeSort).toBeNull();
    expect(parsed.durationSort).toBe("desc");
    expect(parsed.cursor).toBeNull();
    expect(parsed.durationCursor).toEqual({ elapsed: "", cdrId: "cdr-9" });
  });

  it("refuses a seconds cursor that is missing one part or the snapshot", () => {
    expect(() =>
      parseOprsListSearch(
        new URLSearchParams({ durationSort: "asc", cursorId: "a" }),
      ),
    ).toThrow(OprsQueryError);
    expect(() =>
      parseOprsListSearch(
        new URLSearchParams({
          durationSort: "asc",
          cursorElapsed: "1000",
          snapshot: "2026-11-13T00:00:00.000Z",
        }),
      ),
    ).toThrow(OprsQueryError);
    expect(() =>
      parseOprsListSearch(
        new URLSearchParams({
          durationSort: "asc",
          cursorElapsed: "",
          cursorId: "a",
        }),
      ),
    ).toThrow(OprsQueryError);
  });

  it("reads a cursor only when both parts and the snapshot are present", () => {
    const params = new URLSearchParams({
      cursorDate: "2026-11-01 00:00:00",
      cursorId: "a",
      snapshot: "2026-11-13T00:00:00.000Z",
      month: "2026-11",
    });
    expect(parseOprsListSearch(params).cursor).toEqual({
      cdrDate: "2026-11-01 00:00:00",
      cdrId: "a",
    });
  });

  it("refuses a facet without a column", () => {
    expect(() => parseOprsFacetSearch(new URLSearchParams())).toThrow(OprsQueryError);
  });
});

describe("oprs urls", () => {
  it("keeps the traffic list on /api/traffic", () => {
    expect(buildTrafficListUrl({ month: "2026-11" })).toBe("/api/traffic?month=2026-11");
  });

  it("points the OPRS list and facets at their own routes", () => {
    const list = buildOprsListUrl({
      month: "2026-11",
      snapshot: "2026-11-13T00:00:00.000Z",
      cursor: { cdrDate: "2026-11-01 00:00:00", cdrId: "a" },
    });
    expect(list.startsWith("/api/oprs?")).toBe(true);
    expect(list).not.toContain("/api/traffic");
    expect(list).toContain("cursorDate=");
    expect(list).toContain("snapshot=");
    const seconds = buildOprsListUrl({
      month: "2026-11",
      snapshot: "2026-11-13T00:00:00.000Z",
      durationSort: "asc",
      timeSort: "desc",
      cursor: { elapsed: "", cdrId: "a" },
    });
    expect(seconds).toContain("durationSort=asc");
    expect(seconds).not.toContain("timeSort=");
    expect(seconds).toContain("cursorElapsed=");
    expect(seconds).toContain("cursorId=a");
    const facets = buildOprsFacetsUrl({
      column: "oprs_marking",
      snapshot: "2026-11-13T00:00:00.000Z",
    });
    expect(facets.startsWith("/api/oprs/facets?")).toBe(true);
    expect(facets).toContain("column=oprs_marking");
  });
});
