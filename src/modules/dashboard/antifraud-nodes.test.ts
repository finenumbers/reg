import { describe, expect, it } from "vitest";
import {
  antifraudChartNodeWhere,
  dashboardCallsCacheKey,
  isAntifraudChartNode,
  parseDashboardAntifraudNode,
} from "@/modules/dashboard/antifraud-nodes";

describe("antifraud chart nodes", () => {
  it("keeps a node only when antifraud is on and the identifier is set", () => {
    expect(isAntifraudChartNode({ antifraudEnabled: true, identifier: "kazan" })).toBe(
      true,
    );
    expect(isAntifraudChartNode({ antifraudEnabled: true, identifier: null })).toBe(
      false,
    );
    expect(isAntifraudChartNode({ antifraudEnabled: true, identifier: "" })).toBe(false);
    expect(isAntifraudChartNode({ antifraudEnabled: false, identifier: "kazan" })).toBe(
      false,
    );
  });

  it("asks the node table for the enabled identified rows", () => {
    expect(antifraudChartNodeWhere()).toEqual({
      antifraudEnabled: true,
      AND: [{ identifier: { not: null } }, { identifier: { not: "" } }],
    });
  });

  it("treats a blank node as every node and rejects a non-address", () => {
    expect(parseDashboardAntifraudNode("af-answers", null)).toEqual({
      ok: true,
      ip: null,
    });
    expect(parseDashboardAntifraudNode("af-delay", "  ")).toEqual({ ok: true, ip: null });
    expect(parseDashboardAntifraudNode("af-timeout", "10.0.0.8")).toEqual({
      ok: true,
      ip: "10.0.0.8",
    });
    expect(parseDashboardAntifraudNode("af-answers", "::ffff:10.0.0.8")).toEqual({
      ok: true,
      ip: "10.0.0.8",
    });
    expect(parseDashboardAntifraudNode("phone", "10.0.0.8")).toEqual({
      ok: true,
      ip: null,
    });
    expect(parseDashboardAntifraudNode("af-answers", "010.0.0.1").ok).toBe(false);
    expect(parseDashboardAntifraudNode("af-answers", "all").ok).toBe(false);
  });

  it("keeps the all-nodes cache key and separates nodes", () => {
    expect(dashboardCallsCacheKey("af-answers", null)).toBe("af-answers");
    expect(dashboardCallsCacheKey("phone", null)).toBe("phone");
    expect(dashboardCallsCacheKey("af-answers", "10.0.0.8")).toBe("af-answers\n10.0.0.8");
    expect(dashboardCallsCacheKey("af-delay", "10.0.0.8")).not.toBe(
      dashboardCallsCacheKey("af-answers", "10.0.0.8"),
    );
  });
});
