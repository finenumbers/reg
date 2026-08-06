import { describe, expect, it } from "vitest";
import {
  buildAuditListUrl,
  formatAuditAction,
  formatAuditActor,
  formatAuditTarget,
  summarizeAuditMeta,
  type AuditLogDisplayItem,
} from "@/modules/audit/ui-format";
import { sanitizeAuditMeta } from "@/modules/audit/sanitize";

function sample(overrides: Partial<AuditLogDisplayItem> = {}): AuditLogDisplayItem {
  return {
    action: "settings.update",
    actorUserId: "u1",
    actorUsername: "admin",
    entityType: "app_settings",
    entityId: "1",
    meta: { regsPollEnabled: true },
    ...overrides,
  };
}

describe("audit sanitize", () => {
  it("redacts secret keys including nested and variants", () => {
    const out = sanitizeAuditMeta({
      host: "softswitch.example",
      password: "secret",
      nested: { privateKey: "KEY", ok: 1 },
      userPassword: "x",
      accessToken: "t",
    });
    expect(out?.host).toBe("softswitch.example");
    expect(out?.password).toBe("[REDACTED]");
    expect((out?.nested as Record<string, unknown>).privateKey).toBe(
      "[REDACTED]",
    );
    expect((out?.nested as Record<string, unknown>).ok).toBe(1);
    expect(out?.userPassword).toBe("[REDACTED]");
    expect(out?.accessToken).toBe("[REDACTED]");
  });
});

describe("audit ui-format", () => {
  it("formats action labels and actor/target", () => {
    expect(formatAuditAction("settings.update")).toBe("Изменение настроек");
    expect(formatAuditAction("custom.event")).toBe("custom.event");
    expect(formatAuditActor(sample())).toBe("admin");
    expect(
      formatAuditActor(sample({ actorUsername: null, actorUserId: null })),
    ).toBe("система / аноним");
    expect(formatAuditTarget(sample())).toBe("app_settings:1");
  });

  it("summarizes meta without dumping large objects", () => {
    expect(summarizeAuditMeta({ a: 1, b: "hello" })).toContain("a=1");
    expect(summarizeAuditMeta({ password: "[REDACTED]" })).toContain(
      "password=[REDACTED]",
    );
    expect(summarizeAuditMeta({ deep: { x: 1 } })).toContain("deep={…}");
  });

  it("builds list URLs", () => {
    expect(buildAuditListUrl()).toBe("/api/audit");
    expect(buildAuditListUrl({ action: "ssh", actor: "admin", page: 3 })).toBe(
      "/api/audit?action=ssh&actor=admin&page=3",
    );
  });
});
