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
    const facets = buildOprsFacetsUrl({
      column: "oprs_marking",
      snapshot: "2026-11-13T00:00:00.000Z",
    });
    expect(facets.startsWith("/api/oprs/facets?")).toBe(true);
    expect(facets).toContain("column=oprs_marking");
  });
});
