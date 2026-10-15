import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { syslogFileKey } from "@/modules/smg-syslog/bucket";
import { listSyslogLevel, openSyslogDownload, streamDownload } from "@/modules/smg-syslog/browse";
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
    await store.commit([packet("10.1.2.3", payload, when)]);
    await store.commit([packet("10.1.2.3", "second", when)]);
    await store.close();

    const later = new Date("2026-10-14T20:00:00Z");
    const again = new SyslogStore(root);
    for (let i = 0; i < 20; i += 1) {
      await again.pumpGzipSlice(later, new Set());
    }
    const gz = path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log.gz");
    const text = gunzipSync(readFileSync(gz));
    expect(text).toEqual(Buffer.concat([payload, Buffer.from("\nsecond\n")]));
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
    await store.commit([packet("10.1.2.3", "live", when)]);
    await store.close();
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
        { slot: "50", label: "50", bytes: Buffer.from("live\n").length, state: "open" },
      ],
    });
  });

  it("sums the raw log and the archive while both are present", () => {
    const root = tempRoot();
    const dir = path.join(root, "10.1.2.3", "2026", "10", "14", "19");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "50.log"), "tail");
    writeFileSync(path.join(dir, "50.log.gz"), Buffer.from([1, 2, 3, 4]));
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
        {
          slot: "50",
          label: "50",
          bytes: 4 + Buffer.byteLength("tail"),
          state: "updating",
        },
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

  it("reopens the same interval without truncating it", async () => {
    const root = tempRoot();
    const store = new SyslogStore(root);
    const when = new Date("2026-10-14T19:51:00Z");
    await store.commit([packet("10.1.2.3", "one", when)]);
    await store.close();
    const again = new SyslogStore(root);
    await again.commit([packet("10.1.2.3", "two", when)]);
    await again.close();
    const raw = readFileSync(
      path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log"),
    );
    expect(raw.toString()).toBe("one\ntwo\n");
  });

  it("files each datagram by its UTC arrival, not by the commit clock", async () => {
    const root = tempRoot();
    const store = new SyslogStore(root);
    await store.commit([
      packet("10.1.2.3", "early", new Date("2026-10-15T01:59:00Z")),
      packet("10.1.2.3", "later", new Date("2026-10-15T02:05:00Z")),
    ]);
    await store.close();
    expect(
      readFileSync(
        path.join(root, "10.1.2.3", "2026", "10", "15", "01", "50.log"),
        "utf8",
      ),
    ).toBe("early\n");
    expect(
      readFileSync(
        path.join(root, "10.1.2.3", "2026", "10", "15", "02", "00.log"),
        "utf8",
      ),
    ).toBe("later\n");
  });

  it("keeps the next batch when the previous fsync failed", async () => {
    const root = tempRoot();
    const store = new SyslogStore(root);
    store.failNextFsync();
    await expect(
      store.commit([packet("10.1.2.3", "early", new Date("2026-10-15T01:59:00Z"))]),
    ).rejects.toThrow(/fsync failed/);
    expect(store.dirty()).toBe(true);
    await store.commit([packet("10.1.2.3", "later", new Date("2026-10-15T02:05:00Z"))]);
    await store.close();
    expect(
      readFileSync(
        path.join(root, "10.1.2.3", "2026", "10", "15", "01", "50.log"),
        "utf8",
      ),
    ).toBe("early\n");
    expect(
      readFileSync(
        path.join(root, "10.1.2.3", "2026", "10", "15", "02", "00.log"),
        "utf8",
      ),
    ).toBe("later\n");
  });

  it("does not archive a slot that still has queued datagrams", async () => {
    const root = tempRoot();
    const when = new Date("2026-10-14T19:50:30Z");
    const store = new SyslogStore(root);
    await store.commit([packet("10.1.2.3", "queued", when)]);
    await store.close();
    const again = new SyslogStore(root);
    const key = syslogFileKey("10.1.2.3", when);
    await again.pumpGzipSlice(new Date("2026-10-14T20:00:00Z"), new Set([key]));
    const raw = path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log");
    expect(readFileSync(raw, "utf8")).toBe("queued\n");
    expect(existsSync(`${raw}.gz`)).toBe(false);
  });

  it("drops an in-progress archive when the slot is queued again and keeps the raw bytes", async () => {
    const root = tempRoot();
    const when = new Date("2026-10-14T19:50:30Z");
    const store = new SyslogStore(root);
    await store.commit([packet("10.1.2.3", "queued", when)]);
    await store.close();
    const again = new SyslogStore(root);
    const later = new Date("2026-10-14T20:00:00Z");
    await again.pumpGzipSlice(later, new Set());
    await again.pumpGzipSlice(later, new Set([syslogFileKey("10.1.2.3", when)]));
    const raw = path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log");
    expect(readFileSync(raw, "utf8")).toBe("queued\n");
    expect(existsSync(`${raw}.gz`)).toBe(false);
  });

  it("keeps a payload that already ends with a line feed and does not add another", async () => {
    const root = tempRoot();
    const store = new SyslogStore(root);
    const when = new Date("2026-10-14T19:51:00Z");
    await store.commit([
      packet("10.1.2.3", "abc\n", when),
      packet("10.1.2.3", "def", when),
    ]);
    await store.close();
    expect(
      readFileSync(path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log"), "utf8"),
    ).toBe("abc\ndef\n");
  });

  it("does not store an empty datagram", async () => {
    const root = tempRoot();
    const store = new SyslogStore(root);
    const when = new Date("2026-10-14T19:51:00Z");
    await store.commit([packet("10.1.2.3", Buffer.alloc(0), when)]);
    await store.close();
    expect(existsSync(path.join(root, "10.1.2.3"))).toBe(false);
  });

  it("separates a new datagram from a legacy tail and rolls that write back", async () => {
    const root = tempRoot();
    const when = new Date("2026-10-14T19:51:00Z");
    const raw = path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log");
    mkdirSync(path.dirname(raw), { recursive: true });
    writeFileSync(raw, "onetwo");
    const store = new SyslogStore(root);
    store.failNextWrite();
    await expect(store.commit([packet("10.1.2.3", "three", when)])).rejects.toThrow(
      /write failed/,
    );
    expect(readFileSync(raw, "utf8")).toBe("onetwo");
    await store.commit([packet("10.1.2.3", "three", when)]);
    await store.close();
    expect(readFileSync(raw, "utf8")).toBe("onetwo\nthree\n");
  });

  it("does not insert a blank line when the file already ends with a line feed", async () => {
    const root = tempRoot();
    const when = new Date("2026-10-14T19:51:00Z");
    const raw = path.join(root, "10.1.2.3", "2026", "10", "14", "19", "50.log");
    mkdirSync(path.dirname(raw), { recursive: true });
    writeFileSync(raw, "ready\n");
    const store = new SyslogStore(root);
    await store.commit([packet("10.1.2.3", "next", when)]);
    await store.close();
    expect(readFileSync(raw, "utf8")).toBe("ready\nnext\n");
  });

  it("puts one line feed between a legacy archive and a new raw log", async () => {
    const root = tempRoot();
    const when = new Date("2026-10-14T19:50:30Z");
    const dir = path.join(root, "10.1.2.3", "2026", "10", "14", "19");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "50.log.gz"), gzipSync(Buffer.from("oldblob")));
    const store = new SyslogStore(root);
    await store.commit([packet("10.1.2.3", "msg", when)]);
    await store.close();
    const again = new SyslogStore(root);
    const later = new Date("2026-10-14T20:00:00Z");
    for (let i = 0; i < 20; i += 1) await again.pumpGzipSlice(later, new Set());
    expect(gunzipSync(readFileSync(path.join(dir, "50.log.gz")))).toEqual(
      Buffer.from("oldblob\nmsg\n"),
    );
  });

  it("does not add a blank line when the archive already ends with a line feed", async () => {
    const root = tempRoot();
    const when = new Date("2026-10-14T19:50:30Z");
    const dir = path.join(root, "10.1.2.3", "2026", "10", "14", "19");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "50.log.gz"), gzipSync(Buffer.from("old\n")));
    const store = new SyslogStore(root);
    await store.commit([packet("10.1.2.3", "msg", when)]);
    await store.close();
    const again = new SyslogStore(root);
    const later = new Date("2026-10-14T20:00:00Z");
    for (let i = 0; i < 20; i += 1) await again.pumpGzipSlice(later, new Set());
    expect(gunzipSync(readFileSync(path.join(dir, "50.log.gz")))).toEqual(
      Buffer.from("old\nmsg\n"),
    );
  });

  it("inserts one line feed when a legacy archive and a raw log are downloaded together", async () => {
    const root = tempRoot();
    const dir = path.join(root, "10.1.2.3", "2026", "10", "14", "19");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "50.log.gz"), gzipSync(Buffer.from("oldblob")));
    writeFileSync(path.join(dir, "50.log"), "msg\n");
    const opened = openSyslogDownload(root, "10.1.2.3", {
      year: "2026",
      month: "10",
      day: "14",
      hour: "19",
      slot: "50",
    });
    expect(opened?.kind).toBe("combined");
    if (opened?.kind !== "combined") return;
    const streamed = streamDownload(opened);
    const chunks: Buffer[] = [];
    for await (const chunk of streamed.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from("oldblob\nmsg\n"));
  });
});
