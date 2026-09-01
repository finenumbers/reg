import { describe, expect, it } from "vitest";
import { sortDetailRows, type DetailMetricRow } from "@/modules/detail/sort";

function row(
  client: string,
  minutes: Partial<Pick<DetailMetricRow, "inMinutes" | "outMinutes" | "ldcMinutes">>,
): DetailMetricRow {
  return {
    client,
    inCalls: 0,
    inMinutes: minutes.inMinutes ?? 0,
    outCalls: 0,
    outMinutes: minutes.outMinutes ?? 0,
    parkingCalls: 0,
    parkingMinutes: 0,
    externalCalls: 0,
    externalMinutes: 0,
    ldcCalls: 0,
    ldcMinutes: minutes.ldcMinutes ?? 0,
  };
}

describe("sortDetailRows", () => {
  const rows = [
    row("Ягода", { inMinutes: 10, ldcMinutes: 5 }),
    row("Альфа", { inMinutes: 30, ldcMinutes: 5 }),
    row("Бета", { inMinutes: 30, ldcMinutes: 1 }),
  ];

  it("sorts the full set alphabetically in ru", () => {
    expect(sortDetailRows(rows, "client").map((item) => item.client)).toEqual([
      "Альфа",
      "Бета",
      "Ягода",
    ]);
  });

  it("sorts by group minutes desc with client tie-break", () => {
    expect(sortDetailRows(rows, "in").map((item) => item.client)).toEqual([
      "Альфа",
      "Бета",
      "Ягода",
    ]);
    expect(sortDetailRows(rows, "ldc").map((item) => item.client)).toEqual([
      "Альфа",
      "Ягода",
      "Бета",
    ]);
  });

  it("does not mutate the input and keeps the tail after a window slice", () => {
    const sorted = sortDetailRows(rows, "in");
    expect(rows[0]?.client).toBe("Ягода");
    expect(sorted.slice(0, 1).map((item) => item.client)).toEqual(["Альфа"]);
    expect(sorted.slice(1).map((item) => item.client)).toEqual(["Бета", "Ягода"]);
  });
});
