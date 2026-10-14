import { describe, expect, it } from "vitest";
import { canonicalIpv4, looksLikeDockerBridge } from "@/modules/smg-syslog/ip";

describe("canonical SMG syslog address", () => {
  it("keeps a dotted IPv4", () => {
    expect(canonicalIpv4("10.1.2.3")).toBe("10.1.2.3");
  });

  it("unwraps an IPv4-mapped address", () => {
    expect(canonicalIpv4("::ffff:10.1.2.3")).toBe("10.1.2.3");
  });

  it("rejects leading zeros", () => {
    expect(canonicalIpv4("010.1.2.3")).toBeNull();
  });

  it("recognises a docker bridge gateway", () => {
    expect(looksLikeDockerBridge("172.18.0.1")).toBe(true);
    expect(looksLikeDockerBridge("10.1.2.3")).toBe(false);
  });
});
