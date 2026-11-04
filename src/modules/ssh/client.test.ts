import { describe, expect, it } from "vitest";
import { concatUtf8Chunks } from "@/lib/utf8-truncate";
import {
  buildAllowlistedExecCommand,
  Ssh2Client,
} from "@/modules/ssh/client";
import { ACTION_REGISTRY, resolveActionForExecution } from "@/modules/actions/registry";

describe("SSH UTF-8 chunk reassembly", () => {
  it("keeps Регистрация intact when «с» is split across buffers", () => {
    const full = Buffer.from(
      '{"Регистрация":"Нет","Название":"Finenumbers_78432121230"}',
      "utf8",
    );
    const cyrS = Buffer.from("с", "utf8");
    const splitAt = full.indexOf(cyrS);
    const decoded = concatUtf8Chunks([
      full.subarray(0, splitAt + 1),
      full.subarray(splitAt + 1),
    ]);
    expect(decoded).toContain('"Регистрация":"Нет"');
    expect(decoded).not.toContain("\uFFFD");
  });
});

describe("buildAllowlistedExecCommand", () => {
  it("does not build an SSH command for regs.poll", () => {
    expect(ACTION_REGISTRY["regs.poll"].kind).toBe("local");
    expect(ACTION_REGISTRY["regs.poll"].remotePath).not.toContain("check_regs.sh");
    expect(() => resolveActionForExecution("regs.poll")).toThrow(/local-only/);
  });

  it("returns cd+/sudo ./export.py for phones.sync", () => {
    expect(buildAllowlistedExecCommand(ACTION_REGISTRY["phones.sync"])).toBe(
      "/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./export.py'",
    );
  });

  it("does not build an SSH command for groups.sync", () => {
    expect(ACTION_REGISTRY["groups.sync"].kind).toBe("local");
    expect(ACTION_REGISTRY["groups.sync"].remotePath).not.toContain("export.py");
    expect(() => resolveActionForExecution("groups.sync")).toThrow(/local-only/);
  });

  it("returns bare path when elevateWithSudo is false", () => {
    expect(
      buildAllowlistedExecCommand({
        ...ACTION_REGISTRY["phones.sync"],
        elevateWithSudo: false,
      }),
    ).toBe("/opt/scripts/export.py");
  });

  it("rejects non-empty argv", () => {
    expect(() =>
      buildAllowlistedExecCommand({
        ...ACTION_REGISTRY["phones.sync"],
        argv: ["--oops"],
      }),
    ).toThrow(/argv/);
  });

  it("does not request a PTY", () => {
    expect(ACTION_REGISTRY["regs.poll"].needsPty).toBe(false);
    expect(ACTION_REGISTRY["phones.sync"].needsPty).toBe(false);
    expect(ACTION_REGISTRY["groups.sync"].needsPty).toBe(false);
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
