import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { listSyslogLevel, openSyslogDownload } from "@/modules/smg-syslog/browse";
import { SyslogStore } from "@/modules/smg-syslog/store";

const dirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "smg-syslog-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("syslog files", () => {
  it("appends a known source and gzips a closed interval back to the same bytes", async () => {
    const root = tempRoot();
    const store = new SyslogStore(root, 0);
    const when = new Date("2026-10-14T19:50:30Z");
    const payload = Buffer.from([0x41, 0xff, 0x42]);
    store.commit([{ ip: "10.1.2.3", payload }], when);
    store.commit([{ ip: "10.1.2.3", payload: Buffer.from("second") }], when);
    store.close();

    const later = new Date("2026-10-14T20:00:00Z");
    for (let i = 0; i < 20; i += 1) {
      await store.pumpGzipSlice(later);
    }
    const gz = path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log.gz");
    const text = gunzipSync(readFileSync(gz));
    expect(text).toEqual(Buffer.concat([payload, Buffer.from("\nsecond\n")]));
    expect(listSyslogLevel(root, "10.1.2.3", { year: "2026", month: "10", day: "14", hour: "19" })).toEqual({
      kind: "files",
      files: [{ slot: "50", label: "50", bytes: readFileSync(gz).length, state: "archive" }],
    });
    const opened = openSyslogDownload(root, "10.1.2.3", {
      year: "2026",
      month: "10",
      day: "14",
      hour: "19",
      slot: "50",
    });
    expect(opened?.kind).toBe("file");
    if (opened?.kind === "file") expect(opened.filename).toBe("10.1.2.3_2026-10-14_19-50.log.gz");
  });

  it("does not gzip the interval that is still open", async () => {
    const root = tempRoot();
    const store = new SyslogStore(root, 0);
    const when = new Date("2026-10-14T19:50:30Z");
    store.commit([{ ip: "10.1.2.3", payload: Buffer.from("live") }], when);
    store.close();
    await store.pumpGzipSlice(when);
    const list = listSyslogLevel(root, "10.1.2.3", {
      year: "2026",
      month: "10",
      day: "14",
      hour: "19",
    });
    expect(list).toEqual({
      kind: "files",
      files: [{ slot: "50", label: "50", bytes: Buffer.from("live\n").length, state: "open" }],
    });
  });

  it("refuses a path that leaves the device directory", () => {
    const root = tempRoot();
    expect(listSyslogLevel(root, "../secret", { year: "2026" })).toBeNull();
    expect(openSyslogDownload(root, "10.1.2.3", {
      year: "2026",
      month: "10",
      day: "14",
      hour: "19",
      slot: "99",
    })).toBeNull();
  });

  it("reopens the same interval without truncating it", () => {
    const root = tempRoot();
    const store = new SyslogStore(root, 0);
    const when = new Date("2026-10-14T19:51:00Z");
    store.commit([{ ip: "10.1.2.3", payload: Buffer.from("one") }], when);
    store.close();
    const again = new SyslogStore(root, 0);
    again.commit([{ ip: "10.1.2.3", payload: Buffer.from("two") }], when);
    again.close();
    const raw = readFileSync(path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log"));
    expect(raw.toString()).toBe("one\ntwo\n");
  });
});
