import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { applyJsonColumnFilters } from "@/modules/phones/json-filters";

describe("capacity filter", () => {
  it("matches a blank cell and a literal Премиум together", () => {
    const where = applyJsonColumnFilters({ id: "1" }, { "ТЕРМ. емкость": ["Премиум"] });
    expect(where).toEqual({
      AND: [
        { id: "1" },
        {
          OR: [
            { data: { path: ["ТЕРМ. емкость"], equals: "" } },
            { data: { path: ["ТЕРМ. емкость"], equals: "Премиум" } },
            { data: { path: ["ТЕРМ. емкость"], equals: Prisma.AnyNull } },
          ],
        },
      ],
    });
  });

  it("matches a missing category key and a stored empty string", () => {
    const where = applyJsonColumnFilters({}, { Категория: ["__empty__"] });
    expect(where).toEqual({
      AND: [
        {},
        {
          OR: [
            { data: { path: ["Категория"], equals: "" } },
            { data: { path: ["Категория"], equals: Prisma.AnyNull } },
          ],
        },
      ],
    });
  });

  it("matches a missing status key the same way", () => {
    const where = applyJsonColumnFilters({}, { Статус: ["__empty__"] });
    expect(where).toEqual({
      AND: [
        {},
        {
          OR: [
            { data: { path: ["Статус"], equals: "" } },
            { data: { path: ["Статус"], equals: Prisma.AnyNull } },
          ],
        },
      ],
    });
  });
});
