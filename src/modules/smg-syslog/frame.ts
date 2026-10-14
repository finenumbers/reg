/**
 * One UDP datagram becomes one file record. Empty payloads carry no bytes.
 * A missing trailing newline is added so the next datagram starts on its own line.
 */

export function frameDatagram(payload: Buffer): Buffer | null {
  if (payload.length === 0) return null;
  if (payload[payload.length - 1] === 0x0a) return payload;
  return Buffer.concat([payload, Buffer.from("\n")]);
}
