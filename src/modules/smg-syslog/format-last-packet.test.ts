import { describe, expect, it } from "vitest";
import { formatLastPacket } from "@/modules/smg-syslog/format-last-packet";

describe("formatLastPacket", () => {
  it("keeps a late UTC hour on the same UTC date", () => {
    expect(formatLastPacket("2026-10-15T23:30:06.123Z")).toBe("23:30:06 (15.10.2026)");
  });

  it("returns null for a value that is not a time", () => {
    expect(formatLastPacket("not-a-time")).toBeNull();
  });
});
