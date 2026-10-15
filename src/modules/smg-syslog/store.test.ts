import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { syslogFileKey } from "@/modules/smg-syslog/bucket";
import { listSyslogLevel, openSyslogDownload } from "@/modules/smg-syslog/browse";
import { SyslogStore, type SyslogPacket } from "@/modules/smg-syslog/store";

const dirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "smg-syslog-"));
  dirs.push(dir);
  return dir;
}

function packet(ip: string, payload: string | Buffer, receivedAt: Date): SyslogPacket {
  return {
    ip,
    payload: Buffer.isBuffer(payload) ? payload : Buffer.from(payload),
    receivedAt,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("syslog files", () => {
  it("appends a known source and gzips a closed interval back to the same bytes", async () => {
    const root = tempRoot();
    const store = new SyslogStore(root);
    const when = new Date("2026-10-14T19:50:30Z");
    const payload = Buffer.from([0x41, 0xff, 0x42]);
    store.commit([packet("10.1.2.3", payload, when)]);
    store.commit([packet("10.1.2.3", "second", when)]);
    store.close();

    const later = new Date("2026-10-14T20:00:00Z");
    const again = new SyslogStore(root);
    for (let i = 0; i < 20; i += 1) {
      await again.pumpGzipSlice(later, new Set());
    }
    const gz = path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log.gz");
    const text = gunzipSync(readFileSync(gz));
    expect(text).toEqual(Buffer.concat([payload, Buffer.from("second")]));
    expect(
      listSyslogLevel(root, "10.1.2.3", {
        year: "2026",
        month: "10",
        day: "14",
        hour: "19",
      }),
    ).toEqual({
      kind: "files",
      files: [
        { slot: "50", label: "50", bytes: readFileSync(gz).length, state: "archive" },
      ],
    });
    const opened = openSyslogDownload(root, "10.1.2.3", {
      year: "2026",
      month: "10",
      day: "14",
      hour: "19",
      slot: "50",
    });
    expect(opened?.kind).toBe("file");
    if (opened?.kind === "file")
      expect(opened.filename).toBe("10.1.2.3_2026-10-14_19-50.log.gz");
  });

  it("does not gzip the interval that is still open", async () => {
    const root = tempRoot();
    const store = new SyslogStore(root);
    const when = new Date("2026-10-14T19:50:30Z");
    store.commit([packet("10.1.2.3", "live", when)]);
    store.close();
    const again = new SyslogStore(root);
    await again.pumpGzipSlice(when, new Set());
    const list = listSyslogLevel(root, "10.1.2.3", {
      year: "2026",
      month: "10",
      day: "14",
      hour: "19",
    });
    expect(list).toEqual({
      kind: "files",
      files: [
        { slot: "50", label: "50", bytes: Buffer.from("live").length, state: "open" },
      ],
    });
  });

  it("refuses a path that leaves the device directory", () => {
    const root = tempRoot();
    expect(listSyslogLevel(root, "../secret", { year: "2026" })).toBeNull();
    expect(
      openSyslogDownload(root, "10.1.2.3", {
        year: "2026",
        month: "10",
        day: "14",
        hour: "19",
        slot: "99",
      }),
    ).toBeNull();
  });

  it("reopens the same interval without truncating it", () => {
    const root = tempRoot();
    const store = new SyslogStore(root);
    const when = new Date("2026-10-14T19:51:00Z");
    store.commit([packet("10.1.2.3", "one", when)]);
    store.close();
    const again = new SyslogStore(root);
    again.commit([packet("10.1.2.3", "two", when)]);
    again.close();
    const raw = readFileSync(
      path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log"),
    );
    expect(raw.toString()).toBe("onetwo");
  });

  it("files each datagram by its UTC arrival, not by the commit clock", () => {
    const root = tempRoot();
    const store = new SyslogStore(root);
    store.commit([
      packet("10.1.2.3", "early", new Date("2026-10-15T01:59:00Z")),
      packet("10.1.2.3", "later", new Date("2026-10-15T02:05:00Z")),
    ]);
    store.close();
    expect(
      readFileSync(
        path.join(root, "10.1.2.3", "2026", "10", "15", "01", "50.log"),
        "utf8",
      ),
    ).toBe("early");
    expect(
      readFileSync(
        path.join(root, "10.1.2.3", "2026", "10", "15", "02", "00.log"),
        "utf8",
      ),
    ).toBe("later");
  });

  it("keeps the next batch when the previous fsync failed", () => {
    const root = tempRoot();
    const store = new SyslogStore(root);
    store.failNextFsync();
    expect(() =>
      store.commit([packet("10.1.2.3", "early", new Date("2026-10-15T01:59:00Z"))]),
    ).toThrow(/fsync failed/);
    expect(store.dirty()).toBe(true);
    store.commit([packet("10.1.2.3", "later", new Date("2026-10-15T02:05:00Z"))]);
    store.close();
    expect(
      readFileSync(
        path.join(root, "10.1.2.3", "2026", "10", "15", "01", "50.log"),
        "utf8",
      ),
    ).toBe("early");
    expect(
      readFileSync(
        path.join(root, "10.1.2.3", "2026", "10", "15", "02", "00.log"),
        "utf8",
      ),
    ).toBe("later");
  });

  it("does not archive a slot that still has queued datagrams", async () => {
    const root = tempRoot();
    const when = new Date("2026-10-14T19:50:30Z");
    const store = new SyslogStore(root);
    store.commit([packet("10.1.2.3", "queued", when)]);
    store.close();
    const again = new SyslogStore(root);
    const key = syslogFileKey("10.1.2.3", when);
    await again.pumpGzipSlice(new Date("2026-10-14T20:00:00Z"), new Set([key]));
    const raw = path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log");
    expect(readFileSync(raw, "utf8")).toBe("queued");
    expect(existsSync(`${raw}.gz`)).toBe(false);
  });

  it("drops an in-progress archive when the slot is queued again and keeps the raw bytes", async () => {
    const root = tempRoot();
    const when = new Date("2026-10-14T19:50:30Z");
    const store = new SyslogStore(root);
    store.commit([packet("10.1.2.3", "queued", when)]);
    store.close();
    const again = new SyslogStore(root);
    const later = new Date("2026-10-14T20:00:00Z");
    await again.pumpGzipSlice(later, new Set());
    await again.pumpGzipSlice(later, new Set([syslogFileKey("10.1.2.3", when)]));
    const raw = path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log");
    expect(readFileSync(raw, "utf8")).toBe("queued");
    expect(existsSync(`${raw}.gz`)).toBe(false);
  });
});
