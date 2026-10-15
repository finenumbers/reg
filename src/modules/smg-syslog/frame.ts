/**
 * Empty payloads carry no bytes and are not stored.
 * Any other datagram is kept exactly as it arrived.
 */

export function frameDatagram(payload: Buffer): Buffer | null {
  if (payload.length === 0) return null;
  return payload;
}
