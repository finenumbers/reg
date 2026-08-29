import { describe, expect, it } from "vitest";
import {
  elapsedMsToSeconds,
  monthExportStages,
} from "@/modules/traffic/month-export-types";

describe("elapsedMsToSeconds", () => {
  it("ceils milliseconds like the traffic UI", () => {
    expect(elapsedMsToSeconds("24383")).toBe(25);
    expect(elapsedMsToSeconds("1000")).toBe(1);
  });

  it("treats blank or invalid as 0", () => {
    expect(elapsedMsToSeconds("")).toBe(0);
    expect(elapsedMsToSeconds("  ")).toBe(0);
    expect(elapsedMsToSeconds("abc")).toBe(0);
  });
});

describe("monthExportStages", () => {
  it("omits the detail stage for a one-sheet export", () => {
    expect(monthExportStages(false).map((stage) => stage.id)).toEqual([
      "period",
      "read",
      "fill",
      "traffic",
      "download",
    ]);
    expect(monthExportStages(true).some((stage) => stage.id === "detail")).toBe(
      true,
    );
  });
});
