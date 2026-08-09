import { describe, expect, it } from "vitest";
import { parseGroupsStdout } from "@/modules/groups/parse";

describe("parseGroupsStdout", () => {
  it("parses groups[] with ID and Название", () => {
    const payload = parseGroupsStdout(
      JSON.stringify({
        version: 2,
        groups: [
          { ID: "25", Название: "Foreign_UIS" },
          { ID: "10", Название: "Domestic" },
        ],
      }),
    );
    expect(payload.version).toBe(2);
    expect(payload.groups).toEqual([
      { externalId: "25", name: "Foreign_UIS" },
      { externalId: "10", name: "Domestic" },
    ]);
  });

  it("rejects missing groups array", () => {
    expect(() => parseGroupsStdout(JSON.stringify({ version: 2 }))).toThrow(
      /groups\[\]/,
    );
  });

  it("rejects duplicate names", () => {
    expect(() =>
      parseGroupsStdout(
        JSON.stringify({
          groups: [
            { ID: "1", Название: "A" },
            { ID: "2", Название: "A" },
          ],
        }),
      ),
    ).toThrow(/duplicate Название/);
  });

  it("rejects empty stdout", () => {
    expect(() => parseGroupsStdout("")).toThrow(/Empty/);
  });
});
