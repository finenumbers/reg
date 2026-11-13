import { describe, expect, it } from "vitest";
import {
  decideFacetLoad,
  facetReloadKey,
  type FacetScope,
} from "@/components/column-filters/facet-reload";
import type { FacetItem } from "@/components/column-filters/types";

const ITEMS: FacetItem[] = [
  { value: "МТС", count: 2 },
  { value: "Билайн", count: 1 },
];

function scope(patch: Partial<FacetScope> = {}): FacetScope {
  return {
    column: "bill_ani",
    q: "",
    scopeKey: "/api/oprs/facets?column=bill_ani&month=2026-11",
    filters: {},
    ...patch,
  };
}

const match = (value: string, q: string) => value.toLowerCase().includes(q.toLowerCase());

describe("facetReloadKey", () => {
  it("ignores the list snapshot and keeps month, phone, and flags", () => {
    const first =
      "/api/oprs/facets?snapshot=2026-11-13T00:00:00.000Z&column=bill_ani&month=2026-11&phoneQ=900&failed=1";
    const second = first.replace(
      "snapshot=2026-11-13T00:00:00.000Z",
      "snapshot=2026-11-13T01:00:00.000Z",
    );
    expect(facetReloadKey(first)).toBe(facetReloadKey(second));
    expect(facetReloadKey(first)).not.toContain("snapshot");
    expect(facetReloadKey(first)).not.toBe(
      facetReloadKey(first.replace("month=2026-11", "month=2026-10")),
    );
    expect(facetReloadKey(first)).not.toBe(
      facetReloadKey(first.replace("phoneQ=900", "phoneQ=901")),
    );
    expect(facetReloadKey(first)).not.toBe(
      facetReloadKey(first.replace("&failed=1", "")),
    );
    expect(facetReloadKey(first)).not.toBe(
      facetReloadKey(first.replace("column=bill_ani", "column=bill_dnis")),
    );
  });
});

describe("decideFacetLoad", () => {
  const full = { ...scope(), items: ITEMS };

  it("filters a complete list in place and asks again when that list was cut off", () => {
    expect(
      decideFacetLoad({
        next: scope({ q: "мтс" }),
        loaded: scope(),
        full,
        match,
      }),
    ).toEqual({ kind: "local", items: [ITEMS[0]] });
    expect(
      decideFacetLoad({
        next: scope(),
        loaded: scope({ q: "мтс" }),
        full,
        match,
      }),
    ).toEqual({ kind: "local", items: ITEMS });
    expect(
      decideFacetLoad({
        next: scope({ q: "м" }),
        loaded: scope(),
        full: null,
        match,
      }).kind,
    ).toBe("fetch");
  });

  it("keeps the menu for the open column and fetches when another filter changes", () => {
    expect(
      decideFacetLoad({
        next: scope({ filters: { bill_ani: ["МТС"] } }),
        loaded: scope(),
        full,
        match,
      }).kind,
    ).toBe("keep");
    expect(
      decideFacetLoad({
        next: scope({
          q: "м",
          scopeKey: "/api/oprs/facets?column=bill_ani&month=2026-10",
        }),
        loaded: scope(),
        full,
        match,
      }).kind,
    ).toBe("fetch");
    expect(
      decideFacetLoad({
        next: scope({ filters: { bill_dnis: ["100"] } }),
        loaded: scope(),
        full,
        match,
      }).kind,
    ).toBe("fetch");
    expect(
      decideFacetLoad({
        next: scope({ q: "мтс" }),
        loaded: scope(),
        full,
        match: undefined,
      }).kind,
    ).toBe("fetch");
  });
});
