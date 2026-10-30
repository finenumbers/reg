import { describe, expect, it } from "vitest";
import { geographyAppendAllowed } from "@/modules/number-geography/paging";

describe("geographyAppendAllowed", () => {
  it("appends only while the catalog snapshot is unchanged", () => {
    expect(geographyAppendAllowed("2026-10-31T00:00:00.000Z", "2026-10-31T00:00:00.000Z")).toBe(
      true,
    );
    expect(geographyAppendAllowed("2026-10-31T00:00:00.000Z", "2026-10-31T00:00:01.000Z")).toBe(
      false,
    );
  });
});
