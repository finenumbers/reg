import { describe, expect, it } from "vitest";
import {
  buildAllowlistedExecCommand,
  Ssh2Client,
} from "@/modules/ssh/client";
import { ACTION_REGISTRY } from "@/modules/actions/registry";

describe("buildAllowlistedExecCommand", () => {
  it("returns cd+/sudo ./script for regs.poll (elevateWithSudo)", () => {
    expect(buildAllowlistedExecCommand(ACTION_REGISTRY["regs.poll"])).toBe(
      "/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./check_regs.sh'",
    );
  });

  it("returns cd+/sudo ./export.py for phones.sync", () => {
    expect(buildAllowlistedExecCommand(ACTION_REGISTRY["phones.sync"])).toBe(
      "/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./export.py'",
    );
  });

  it("returns bare path when elevateWithSudo is false", () => {
    expect(
      buildAllowlistedExecCommand({
        ...ACTION_REGISTRY["regs.poll"],
        elevateWithSudo: false,
      }),
    ).toBe("/opt/scripts/check_regs.sh");
  });

  it("rejects non-empty argv", () => {
    expect(() =>
      buildAllowlistedExecCommand({
        ...ACTION_REGISTRY["regs.poll"],
        argv: ["--oops"],
      }),
    ).toThrow(/argv/);
  });

  it("marks needsPty only for regs.poll", () => {
    expect(ACTION_REGISTRY["regs.poll"].needsPty).toBe(true);
    expect(ACTION_REGISTRY["phones.sync"].needsPty).toBe(false);
  });
});

describe("Ssh2Client.testConnection", () => {
  const client = new Ssh2Client();

  it("returns timeout/error for unreachable host without hanging forever", async () => {
    const outcome = await client.testConnection(
      {
        host: "127.0.0.1",
        port: 1,
        username: "nobody",
        privateKeyPem:
          "-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key\n-----END OPENSSH PRIVATE KEY-----\n",
      },
      2_000,
    );

    expect(["auth_error", "timeout", "error"]).toContain(outcome.result);
    expect(outcome.detail.toLowerCase()).not.toContain("private key");
    expect(outcome.detail).not.toMatch(/BEGIN/);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  }, 10_000);
});
