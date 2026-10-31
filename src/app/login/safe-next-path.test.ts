import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/app/login/safe-next-path";

describe("safeNextPath", () => {
  it("keeps an in-app path", () => {
    expect(safeNextPath("/phones")).toBe("/phones");
    expect(safeNextPath("/settings")).toBe("/settings");
    expect(safeNextPath(null)).toBe("/");
  });

  it("drops a path the URL parser would send to another origin", () => {
    expect(safeNextPath("/\\example.com")).toBe("/");
    expect(safeNextPath("/%09/example.com")).toBe("/");
    expect(safeNextPath("/%5Cexample.com")).toBe("/");
    expect(safeNextPath("//example.com")).toBe("/");
  });
});
