import { createHash } from "node:crypto";
import { PARKING_HOST_KEY_SHA256 } from "@/modules/antifraud/constants";

/** OpenSSH-style SHA256 fingerprint, padding stripped. */
export function hostKeyFingerprint(key: Buffer): string {
  const digest = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  return `SHA256:${digest}`;
}

export function acceptParkingHostKey(key: Buffer): boolean {
  return hostKeyFingerprint(key) === PARKING_HOST_KEY_SHA256;
}
