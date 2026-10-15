import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetSyslogVolumeOnce, SYSLOG_VOLUME_RESET_ID } from "@/modules/smg-syslog/reset";
import { runSyslogReceiver } from "@/modules/smg-syslog/run";

const dirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "smg-syslog-reset-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("syslog volume reset", () => {
  it("deletes captured files once and leaves the marker", () => {
    const parent = tempRoot();
    const root = path.join(parent, "vol");
    mkdirSync(root);
    const outside = path.join(parent, "keep.txt");
    writeFileSync(outside, "keep");
    const link = path.join(root, "link");
    symlinkSync(outside, link);
    mkdirSync(path.join(root, "10.1.2.3", "2026"), { recursive: true });
    writeFileSync(path.join(root, "10.1.2.3", "2026", "50.log"), "old");
    writeFileSync(path.join(root, ".status.json"), "{}");

    expect(resetSyslogVolumeOnce(root)).toBe(true);
    expect(existsSync(path.join(root, "10.1.2.3"))).toBe(false);
    expect(existsSync(path.join(root, ".status.json"))).toBe(false);
    expect(existsSync(link)).toBe(false);
    expect(readFileSync(outside, "utf8")).toBe("keep");
    expect(lstatSync(path.join(root, ".volume-reset")).isFile()).toBe(true);
    expect(readFileSync(path.join(root, ".volume-reset"), "utf8").trim()).toBe(
      SYSLOG_VOLUME_RESET_ID,
    );

    writeFileSync(path.join(root, "fresh.log"), "new\n");
    expect(resetSyslogVolumeOnce(root)).toBe(false);
    expect(readFileSync(path.join(root, "fresh.log"), "utf8")).toBe("new\n");
  });

  it("wipes again when the marker is a different generation", () => {
    const root = tempRoot();
    writeFileSync(path.join(root, ".volume-reset"), "other\n");
    writeFileSync(path.join(root, "old.log"), "old");
    expect(resetSyslogVolumeOnce(root)).toBe(true);
    expect(existsSync(path.join(root, "old.log"))).toBe(false);
    expect(readFileSync(path.join(root, ".volume-reset"), "utf8").trim()).toBe(
      SYSLOG_VOLUME_RESET_ID,
    );
  });

  it("does not delete or listen when the marker cannot be read", async () => {
    const root = tempRoot();
    mkdirSync(path.join(root, ".volume-reset"));
    writeFileSync(path.join(root, "old.log"), "old");
    await expect(
      runSyslogReceiver({
        port: 0,
        root,
        loadRegistry: async () => ({ enabled: false, ips: new Set() }),
      }),
    ).rejects.toThrow();
    expect(readFileSync(path.join(root, "old.log"), "utf8")).toBe("old");
  });
});
