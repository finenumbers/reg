const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const HEADER_RE =
  /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;

export type ParsedDetail = {
  loggedAt: Date | null;
  headerRaw: string;
  packetType: string;
  callOrigin: string;
  userName: string;
  callingStationId: string;
  calledStationId: string;
  srcNumberOut: string;
  dstNumberOut: string;
  inTrunk: string;
  outTrunk: string;
  remoteId: string;
  srcIp: string;
  acctSessionId: string;
  attrs: Record<string, string[]>;
};

/** FreeRADIUS `%t` in the C locale. The parking host clock is UTC. */
export function parseDetailHeader(header: string): Date | null {
  const match = HEADER_RE.exec(header.trim());
  if (!match) return null;
  const month = MONTHS[match[1] ?? ""];
  if (month == null) return null;
  const day = Number(match[2]);
  const hour = Number(match[3]);
  const minute = Number(match[4]);
  const second = Number(match[5]);
  const year = Number(match[6]);
  if (day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function first(attrs: Record<string, string[]>, name: string): string {
  return attrs[name]?.[0] ?? "";
}

function ciscoValue(attrs: Record<string, string[]>, key: string): string {
  for (const pair of attrs["Cisco-AVPair"] ?? []) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    if (pair.slice(0, idx) === key) return pair.slice(idx + 1);
  }
  return "";
}

/**
 * One detail block. Invalid UTF-8 is replaced in the text fields.
 * The caller stores the original bytes separately.
 */
export function parseDetailBlock(raw: Buffer): ParsedDetail {
  const text = raw.toString("utf8").replace(/\n+$/, "");
  const lines = text.length === 0 ? [] : text.split("\n");
  const headerRaw =
    lines[0] && !lines[0].startsWith("\t") ? lines[0].replace(/\r$/, "") : "";
  const attrLines = headerRaw ? lines.slice(1) : lines;
  const attrs: Record<string, string[]> = {};
  for (const line of attrLines) {
    const body = line.replace(/^\t/, "").replace(/\r$/, "");
    const eq = body.indexOf(" = ");
    if (eq <= 0) continue;
    const name = body.slice(0, eq).trim();
    if (!name) continue;
    const value = unquote(body.slice(eq + 3));
    const list = attrs[name] ?? [];
    list.push(value);
    attrs[name] = list;
  }
  return {
    loggedAt: headerRaw ? parseDetailHeader(headerRaw) : null,
    headerRaw,
    packetType: first(attrs, "Packet-Type"),
    callOrigin: first(attrs, "h323-call-origin"),
    userName: first(attrs, "User-Name"),
    callingStationId: first(attrs, "Calling-Station-Id"),
    calledStationId: first(attrs, "Called-Station-Id"),
    srcNumberOut: ciscoValue(attrs, "xpgk-src-number-out"),
    dstNumberOut: ciscoValue(attrs, "xpgk-dst-number-out"),
    inTrunk: ciscoValue(attrs, "in-trunkgroup-label"),
    outTrunk: ciscoValue(attrs, "out-trunkgroup-label"),
    remoteId: ciscoValue(attrs, "h323-remote-id"),
    srcIp: first(attrs, "Packet-Src-IP-Address"),
    acctSessionId: first(attrs, "Acct-Session-Id"),
    attrs,
  };
}
