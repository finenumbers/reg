import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PARKING_HOST_KEY_SHA256 } from "@/modules/antifraud/constants";
import { acceptParkingHostKey, hostKeyFingerprint } from "@/modules/antifraud/host-key";

describe("parking host key", () => {
  it("formats an OpenSSH SHA256 fingerprint and refuses a different key", () => {
    const key = Buffer.from("not-the-parking-host-key");
    const digest = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
    expect(hostKeyFingerprint(key)).toBe(`SHA256:${digest}`);
    expect(acceptParkingHostKey(key)).toBe(false);
    expect(PARKING_HOST_KEY_SHA256.startsWith("SHA256:")).toBe(true);
  });
});
