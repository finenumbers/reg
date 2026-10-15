import { describe, expect, it } from "vitest";
import { frameDatagram, lineParts, syslogLineFeed } from "@/modules/smg-syslog/frame";

describe("syslog datagram framing", () => {
  it("keeps a datagram that has no trailing newline", () => {
    const raw = Buffer.from("abc");
    expect(frameDatagram(raw)).toBe(raw);
  });

  it("keeps a datagram that already ends with a newline", () => {
    const raw = Buffer.from("abc\n");
    expect(frameDatagram(raw)).toBe(raw);
  });

  it("keeps non-utf8 bytes", () => {
    const raw = Buffer.from([0xff, 0x00, 0x0a]);
    expect(frameDatagram(raw)).toEqual(raw);
  });

  it("drops an empty datagram", () => {
    expect(frameDatagram(Buffer.alloc(0))).toBeNull();
  });
});

describe("syslog line parts", () => {
  it("adds one line feed when the datagram has none", () => {
    const raw = Buffer.from("abc");
    expect(lineParts(raw)).toEqual([raw, syslogLineFeed]);
  });

  it("does not add a second line feed", () => {
    const raw = Buffer.from("abc\n");
    expect(lineParts(raw)).toEqual([raw]);
    const crlf = Buffer.from("abc\r\n");
    expect(lineParts(crlf)).toEqual([crlf]);
  });

  it("returns nothing for an empty payload", () => {
    expect(lineParts(Buffer.alloc(0))).toEqual([]);
  });
});
