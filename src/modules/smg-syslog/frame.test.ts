import { describe, expect, it } from "vitest";
import { frameDatagram } from "@/modules/smg-syslog/frame";

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
