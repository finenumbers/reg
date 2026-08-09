import { describe, expect, it } from "vitest";
import {
  hasPermission,
  ROLE_PERMISSIONS,
} from "@/modules/rbac/permissions";

describe("RBAC permissions", () => {
  it("grants admin all seeded permissions", () => {
    for (const code of ROLE_PERMISSIONS.admin) {
      expect(hasPermission(ROLE_PERMISSIONS.admin, code)).toBe(true);
    }
  });

  it("denies operator settings and audit", () => {
    expect(hasPermission(ROLE_PERMISSIONS.operator, "settings:write")).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.operator, "audit:read")).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.operator, "regs:read")).toBe(true);
  });

  it("treats missing grants as deny", () => {
    expect(hasPermission(undefined, "regs:read")).toBe(false);
    expect(hasPermission([], "regs:read")).toBe(false);
  });
});
