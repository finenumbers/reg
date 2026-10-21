export const RADIUS_COLUMNS = [
  "day",
  "time",
  "packetType",
  "callOrigin",
  "calling",
  "called",
  "userName",
  "srcOut",
  "dstOut",
  "inTrunk",
  "outTrunk",
  "remoteId",
  "srcIp",
  "session",
] as const;

export type RadiusColumn = (typeof RADIUS_COLUMNS)[number];

export const RADIUS_LABELS: Record<RadiusColumn, string> = {
  day: "Дата",
  time: "Время",
  packetType: "Тип",
  callOrigin: "Направление",
  calling: "A-номер",
  called: "B-номер",
  userName: "User-Name",
  srcOut: "A исх.",
  dstOut: "B исх.",
  inTrunk: "Вход. транк",
  outTrunk: "Исход. транк",
  remoteId: "Remote ID",
  srcIp: "IP источника",
  session: "Сессия",
};

export const RADIUS_FACET_COLUMNS = [
  "packetType",
  "callOrigin",
  "inTrunk",
  "outTrunk",
  "remoteId",
  "srcIp",
] as const;

export type RadiusFacetColumn = (typeof RADIUS_FACET_COLUMNS)[number];

export const RADIUS_PHONE_COLUMNS = [
  "calling",
  "called",
  "userName",
  "srcOut",
  "dstOut",
] as const;

export function isRadiusFacetColumn(column: string): column is RadiusFacetColumn {
  return (RADIUS_FACET_COLUMNS as readonly string[]).includes(column);
}
