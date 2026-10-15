/**
 * Empty payloads carry no bytes and are not stored.
 * Any other datagram is kept exactly as it arrived.
 * Line breaks are added by the store, not here.
 */

/** Shared separator. Callers must not mutate it. */
export const syslogLineFeed = Buffer.from("\n");

export function frameDatagram(payload: Buffer): Buffer | null {
  if (payload.length === 0) return null;
  return payload;
}

/** Payload bytes, then one LF when the datagram does not already end with one. */
export function lineParts(payload: Buffer): readonly Buffer[] {
  if (payload.length === 0) return [];
  if (payload[payload.length - 1] === 0x0a) return [payload];
  return [payload, syslogLineFeed];
}
