import { describe, expect, it } from "vitest";
import {
  emptyParseRejectCounts,
  formatParseRejectCounts,
} from "@/modules/traffic/parse-reject";

describe("formatParseRejectCounts", () => {
  it("joins date, cdr_id, and width reasons", () => {
    expect(formatParseRejectCounts(emptyParseRejectCounts())).toBe("");
    expect(
      formatParseRejectCounts({ width: 2, cdr_id: 1, date: 3 }),
    ).toBe("3 без даты, 1 без cdr_id, 2 с неверным числом полей");
  });
});
