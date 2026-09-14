import { describe, expect, it } from "vitest";
import { FEATURE_MODULES } from "@/lib/modules";

const KNOWN_NAV_GROUPS = new Set(["primary", "cdr", "analytics", "admin"]);

function idsInGroup(group: "cdr" | "analytics" | "admin"): string[] {
  return FEATURE_MODULES.filter((m) => m.navGroup === group).map((m) => m.id);
}

describe("FEATURE_MODULES nav groups", () => {
  it("keeps Детализация and Статистика as analytics, in that order", () => {
    expect(idsInGroup("analytics")).toEqual(["detail", "stats"]);
  });

  it("keeps CDR without Детализация", () => {
    expect(idsInGroup("cdr")).toEqual([
      "traffic",
      "operators",
      "geography",
      "raw",
    ]);
  });

  it("keeps admin without Статистика", () => {
    expect(idsInGroup("admin")).toEqual(["settings", "jobs", "audit"]);
  });

  it("uses only known nav groups", () => {
    for (const module of FEATURE_MODULES) {
      expect(KNOWN_NAV_GROUPS.has(module.navGroup ?? "primary")).toBe(true);
    }
  });
});
