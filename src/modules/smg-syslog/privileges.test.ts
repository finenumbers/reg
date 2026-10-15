import { describe, expect, it } from "vitest";
import { privilegeDropTarget } from "@/modules/smg-syslog/privileges";

describe("privilegeDropTarget", () => {
  it("drops root to the configured user after the privileged bind", () => {
    expect(privilegeDropTarget(0, "1001", "1001")).toEqual({ uid: 1001, gid: 1001 });
  });

  it("leaves a non-root process and an unconfigured root process alone", () => {
    expect(privilegeDropTarget(1001, "1001", "1001")).toBeNull();
    expect(privilegeDropTarget(0, undefined, undefined)).toBeNull();
    expect(privilegeDropTarget(0, "0", "0")).toBeNull();
  });
});