import { describe, expect, it } from "vitest";
import {
  activePurgeHold,
  monthIsHeld,
  rememberPurgeTarget,
} from "@/modules/traffic/purge/hold";

describe("purge hold set", () => {
  it("keeps a month after the live target is cleared", () => {
    const held = new Set<string>();
    rememberPurgeTarget(held, "2026-07");
    expect(monthIsHeld(held, "2026-07")).toBe(true);
    expect(monthIsHeld(held, "2026-08")).toBe(false);
    expect(activePurgeHold(held, "2026-07")).toBe("2026-07");
    expect(activePurgeHold(held, null)).toBeNull();
    expect(monthIsHeld(held, "2026-07")).toBe(true);
  });
});
