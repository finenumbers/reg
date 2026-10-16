import type { TraceAttr } from "@/modules/smg-trace/types";

export type RadiusPacket = {
  code: number;
  id: number;
  attributes: TraceAttr[];
};

export function radiusCodeLabel(code: number): string {
  if (code === 2) return "2 Access-Accept";
  if (code === 3) return "3 Access-Reject";
  return String(code);
}

/**
 * Parse a RADIUS packet from the hex the gateway prints while checking the reply digest.
 * Bytes past the packet length are the shared secret mixed into the digest and are ignored.
 */
export function parseRadiusPacket(hex: string): RadiusPacket | null {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length < 40 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    return null;
  }
  const buf = Buffer.from(clean, "hex");
  if (buf.length < 20) return null;
  const code = buf[0] ?? 0;
  const id = buf[1] ?? 0;
  const length = buf.readUInt16BE(2);
  if (length < 20 || length > buf.length) return null;

  const attributes: TraceAttr[] = [];
  let offset = 20;
  while (offset + 2 <= length) {
    const type = buf[offset] ?? 0;
    const attrLength = buf[offset + 1] ?? 0;
    if (attrLength < 2 || offset + attrLength > length) break;
    const value = buf.subarray(offset + 2, offset + attrLength);
    if (type === 18) {
      attributes.push({ name: "Reply-Message", value: value.toString("latin1") });
    } else if (type === 26) {
      const vendor = vendorAttribute(value);
      if (vendor) attributes.push(vendor);
    }
    offset += attrLength;
  }

  return { code, id, attributes };
}

function vendorAttribute(value: Buffer): TraceAttr | null {
  if (value.length < 6) return null;
  const data = value.subarray(4);
  const vendorLength = data[1] ?? 0;
  if (vendorLength < 2 || vendorLength > data.length) return null;
  const text = data.subarray(2, vendorLength).toString("latin1");
  const eq = text.indexOf("=");
  if (eq <= 0) return text ? { name: "Vendor-Specific", value: text } : null;
  return { name: text.slice(0, eq), value: text.slice(eq + 1) };
}
