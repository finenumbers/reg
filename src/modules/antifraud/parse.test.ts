import { describe, expect, it } from "vitest";
import { parseDetailBlock, parseDetailHeader } from "@/modules/antifraud/parse";

const BLOCK = [
  "Wed Oct 21 06:36:27 2026",
  "\tPacket-Type = Access-Request",
  '\tUser-Name = "79000000001"',
  '\tCalling-Station-Id = "79000000001"',
  '\tCalled-Station-Id = "79000000002"',
  '\tCisco-AVPair = "xpgk-src-number-out=79000000003"',
  '\tCisco-AVPair = "xpgk-dst-number-out=79000000004"',
  '\tCisco-AVPair = "in-trunkgroup-label=вход"',
  '\tCisco-AVPair = "out-trunkgroup-label=out"',
  '\tCisco-AVPair = "h323-remote-id=gw1"',
  '\tCisco-AVPair = "note=a=b"',
  "\tPacket-Src-IP-Address = 10.0.0.1",
  '\tAcct-Session-Id = "abc"',
  "\th323-call-origin = originate",
  '\tVendor-Specific = "kept"',
  "",
].join("\n");

describe("parseDetailHeader", () => {
  it("reads a C-locale UTC stamp, including a padded day", () => {
    expect(parseDetailHeader("Wed Oct 21 06:36:27 2026")?.toISOString()).toBe(
      "2026-10-21T06:36:27.000Z",
    );
    expect(parseDetailHeader("Wed Oct  1 00:00:00 2026")?.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("rejects a header that is not %t", () => {
    expect(parseDetailHeader("2026-10-21 06:36:27")).toBeNull();
  });
});

describe("parseDetailBlock", () => {
  it("keeps repeated Cisco-AVPair values, an equals sign, and an unknown attribute", () => {
    const parsed = parseDetailBlock(Buffer.from(BLOCK, "utf8"));
    expect(parsed.loggedAt?.toISOString()).toBe("2026-10-21T06:36:27.000Z");
    expect(parsed.packetType).toBe("Access-Request");
    expect(parsed.callOrigin).toBe("originate");
    expect(parsed.userName).toBe("79000000001");
    expect(parsed.callingStationId).toBe("79000000001");
    expect(parsed.calledStationId).toBe("79000000002");
    expect(parsed.srcNumberOut).toBe("79000000003");
    expect(parsed.dstNumberOut).toBe("79000000004");
    expect(parsed.inTrunk).toBe("вход");
    expect(parsed.outTrunk).toBe("out");
    expect(parsed.remoteId).toBe("gw1");
    expect(parsed.srcIp).toBe("10.0.0.1");
    expect(parsed.acctSessionId).toBe("abc");
    expect(parsed.attrs["Cisco-AVPair"]).toContain("note=a=b");
    expect(parsed.attrs["Vendor-Specific"]).toEqual(["kept"]);
  });

  it("stores a bad header with a null timestamp", () => {
    const parsed = parseDetailBlock(
      Buffer.from("not-a-date\n\tPacket-Type = Access-Request\n", "utf8"),
    );
    expect(parsed.loggedAt).toBeNull();
    expect(parsed.headerRaw).toBe("not-a-date");
    expect(parsed.packetType).toBe("Access-Request");
  });
});
