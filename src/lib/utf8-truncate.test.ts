import { describe, expect, it } from "vitest";
import { concatUtf8Chunks, truncateUtf8 } from "@/lib/utf8-truncate";

describe("concatUtf8Chunks", () => {
  it("reassembles Cyrillic split across chunk boundaries", () => {
    const full = Buffer.from('"Регистрация":"Нет"', "utf8");
    const splitAt = full.indexOf(Buffer.from("с", "utf8"));
    expect(splitAt).toBeGreaterThan(0);
    // Split mid-character: first byte of «с» (D1) in chunk1, second (81) in chunk2.
    const chunk1 = full.subarray(0, splitAt + 1);
    const chunk2 = full.subarray(splitAt + 1);
    expect(chunk1[chunk1.length - 1]).toBe(0xd1);
    expect(chunk2[0]).toBe(0x81);

    const decoded = concatUtf8Chunks([chunk1, chunk2]);
    expect(decoded).toBe('"Регистрация":"Нет"');
    expect(decoded).not.toContain("\uFFFD");
  });
});

describe("truncateUtf8", () => {
  it("does not split a multi-byte character at the cut", () => {
    const text = "абвгдеёжзий";
    const cut = Buffer.byteLength("абвг", "utf8") + 1; // mid «д»
    const out = truncateUtf8(text, cut);
    expect(out).toContain("…[truncated]");
    expect(out).not.toContain("\uFFFD");
    expect(Buffer.byteLength(out.replace(/\n…\[truncated\]$/, ""), "utf8")).toBeLessThanOrEqual(
      cut,
    );
  });

  it("returns original when under limit", () => {
    expect(truncateUtf8("hello", 100)).toBe("hello");
  });
});
