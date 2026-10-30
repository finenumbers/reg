import { describe, expect, it } from "vitest";
import { applyJsonColumnFilters } from "@/modules/phones/json-filters";

describe("capacity filter", () => {
  it("matches a blank cell and a literal Премиум together", () => {
    const where = applyJsonColumnFilters(
      { id: "1" },
      { "ТЕРМ. емкость": ["Премиум"] },
    );
    expect(where).toEqual({
      AND: [
        { id: "1" },
        {
          OR: [
            { data: { path: ["ТЕРМ. емкость"], equals: "" } },
            { data: { path: ["ТЕРМ. емкость"], equals: "Премиум" } },
          ],
        },
      ],
    });
  });
});
