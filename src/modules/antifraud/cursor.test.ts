import { describe, expect, it } from "vitest";
import {
  parseStat,
  planFileChange,
  takeCompleteRecords,
  type IngestCursor,
} from "@/modules/antifraud/cursor";

const b = (value: number) => BigInt(value);

function block(trunk: string): Buffer {
  return Buffer.from(
    `Wed Oct  1 00:00:00 2026\n\tCisco-AVPair = "in-trunkgroup-label=${trunk}"\n\n`,
    "utf8",
  );
}

describe("takeCompleteRecords", () => {
  it("keeps two identical blocks at different byte offsets", () => {
    const one = block("out");
    const taken = takeCompleteRecords(Buffer.alloc(0), Buffer.concat([one, one]), b(100));
    expect(taken.records).toHaveLength(2);
    expect(taken.records[0]?.fileOffset).toBe(b(100));
    expect(taken.records[1]?.fileOffset).toBe(b(100) + BigInt(one.length));
    expect(
      taken.records[0]?.bytes.equals(taken.records[1]?.bytes ?? Buffer.alloc(0)),
    ).toBe(true);
    expect(taken.nextOffset).toBe(b(100) + BigInt(one.length * 2));
  });

  it("counts a multibyte trunk in bytes and rejoins a chunk split inside UTF-8", () => {
    const bytes = block("вход");
    expect(bytes.length).toBeGreaterThan(bytes.toString("utf8").length);
    const splitAt = bytes.indexOf(Buffer.from("вход", "utf8")) + 1;
    const pending = bytes.subarray(0, splitAt);
    const incoming = bytes.subarray(splitAt);
    const taken = takeCompleteRecords(pending, incoming, BigInt(splitAt));
    expect(taken.records).toHaveLength(1);
    expect(taken.records[0]?.fileOffset).toBe(b(0));
    expect(taken.records[0]?.bytes.equals(bytes)).toBe(true);
    expect(taken.pending.length).toBe(0);
    expect(taken.nextOffset).toBe(BigInt(bytes.length));
  });

  it("leaves an unfinished tail pending and continues after it", () => {
    const bytes = block("out");
    const head = bytes.subarray(0, 10);
    const first = takeCompleteRecords(Buffer.alloc(0), head, b(0));
    expect(first.records).toHaveLength(0);
    expect(first.nextOffset).toBe(b(10));
    const second = takeCompleteRecords(
      first.pending,
      bytes.subarray(10),
      first.nextOffset,
    );
    expect(second.records[0]?.bytes.equals(bytes)).toBe(true);
    expect(second.records[0]?.fileOffset).toBe(b(0));
  });
});

describe("planFileChange", () => {
  const state: IngestCursor = {
    generation: 1,
    inode: "9",
    byteOffset: b(100),
    fileSize: b(500),
    pending: Buffer.from("tail"),
  };

  it("records a gap for an unread tail and flushes the pending bytes", () => {
    const change = planFileChange(state, { size: b(40), inode: "9" });
    expect(change.kind).toBe("reset");
    if (change.kind !== "reset") return;
    expect(change.reason).toBe("file_shrunk");
    expect(change.gap).toEqual({ fromOffset: b(100), toOffset: b(500) });
    expect(change.flushPending.equals(Buffer.from("tail"))).toBe(true);
    expect(change.flushOffset).toBe(b(96));
  });

  it("records only the vanished tail when the read cursor is still inside the file", () => {
    const change = planFileChange(state, { size: b(200), inode: "9" });
    expect(change).toEqual({
      kind: "truncate-tail",
      gap: { fromOffset: b(200), toOffset: b(500) },
    });
  });

  it("does not treat a bad stat line as a file change", () => {
    expect(parseStat("stat: cannot read file")).toBeNull();
    expect(parseStat("100:9\n")).toEqual({ size: b(100), inode: "9" });
  });
});
