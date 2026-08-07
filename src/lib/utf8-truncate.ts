/**
 * Truncate a UTF-8 string to at most maxBytes without splitting a codepoint.
 */

export function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;

  const suffix = "\n…[truncated]";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const limit = Math.max(0, maxBytes - suffixBytes);
  const buf = Buffer.from(text, "utf8");
  let end = Math.min(buf.length, limit);

  // If `end` lands inside a multi-byte sequence, back up to the lead byte
  // so subarray(0, end) contains only complete characters.
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) {
    end -= 1;
  }

  return `${buf.subarray(0, end).toString("utf8")}${suffix}`;
}

/** Decode streamed chunks as a single UTF-8 string (no mid-character splits). */
export function concatUtf8Chunks(chunks: Array<Buffer | string>): string {
  if (chunks.length === 0) return "";
  const buffers = chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)));
  return Buffer.concat(buffers).toString("utf8");
}
