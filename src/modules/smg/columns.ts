/**
 * Canonical Eltex SMG-1016M CDR columns.
 * Short firmware files contain 1–50. Full firmware appends 51–52.
 * Order is the full-file order. Names are matched exactly.
 */

export const SMG_INSERT_BATCH_SIZE = 400;
export const SMG_MAX_FILE_BYTES = 1_000_000_000;
export const SMG_FILE_SETTLE_MS = 2_000;

export const SMG_CDR_NAME_RE = /^(?:\d{14}|\d{8})\.cdr$/;

const KEY_SEP = "\u001f";

export const SMG_COLUMNS = [
  { field: "deviceSign", header: "Device Sign", label: "Узел" },
  { field: "setupTime", header: "Setup time", label: "Время поступления вызова" },
  { field: "connectTime", header: "Connect time", label: "Время ответа на вызов" },
  { field: "disconnectTime", header: "Disconnect time", label: "Время разъединения вызова" },
  { field: "duration", header: "Duration", label: "Длительность вызова" },
  { field: "releaseCause", header: "Release cause", label: "Причина разъединения Q.850" },
  { field: "callReleaseInfo", header: "Call release info", label: "Статус вызова при разъединении" },
  { field: "incomingIp", header: "Incoming IP-address", label: "IP-адрес вызывающего" },
  { field: "incomingType", header: "Incoming type", label: "Тип вызывающего" },
  { field: "incomingDescription", header: "Incoming description", label: "Описание вызывающего" },
  { field: "outgoingIp", header: "Outgoing IP-address", label: "IP-адрес вызываемого" },
  { field: "outgoingType", header: "Outgoing type", label: "Тип вызываемого" },
  { field: "outgoingDescription", header: "Outgoing description", label: "Описание вызываемого" },
  { field: "incomingCgpn", header: "Incoming CgPN", label: "Входящий номер вызывающего" },
  { field: "outgoingCgpn", header: "Outgoing CgPN", label: "Исходящий номер вызывающего" },
  { field: "incomingCdpn", header: "Incoming CdPN", label: "Входящий номер вызываемого" },
  { field: "outgoingCdpn", header: "Outgoing CdPN", label: "Исходящий номер вызываемого" },
  { field: "redirectingMark", header: "Redirecting mark", label: "Метка переадресации" },
  { field: "pickupMark", header: "Pickup mark", label: "Метка перехвата" },
  { field: "releaseSideMark", header: "Release side mark", label: "Метка инициатора разъединения" },
  { field: "incomingSs7Cic", header: "Incoming SS7 CIC", label: "Входящий SS7 CIC" },
  { field: "incomingSipCallId", header: "Incoming SIP Call-ID", label: "Входящий SIP Call-ID" },
  { field: "outgoingSs7Cic", header: "Outgoing SS7 CIC", label: "Исходящий SS7 CIC" },
  { field: "outgoingSipCallId", header: "Outgoing SIP Call-ID", label: "Исходящий SIP Call-ID" },
  { field: "incomingSs7Category", header: "Incoming SS7 category", label: "Входящая SS7 категория" },
  {
    field: "incomingCidCategory",
    header: "Incoming Calling party category (RUS)",
    label: "Входящая категория АОН",
  },
  { field: "outgoingSs7Category", header: "Outgoing SS7 category", label: "Исходящая SS7 категория" },
  {
    field: "outgoingCidCategory",
    header: "Outgoing Calling party category (RUS)",
    label: "Исходящая категория АОН",
  },
  { field: "incomingE1Stream", header: "Incoming E1 stream", label: "Входящий поток Е1" },
  { field: "incomingE1Channel", header: "Incoming E1 channel", label: "Входящий канал Е1" },
  { field: "outgoingE1Stream", header: "Outgoing E1 stream", label: "Исходящий поток Е1" },
  { field: "outgoingE1Channel", header: "Outgoing E1 channel", label: "Исходящий канал Е1" },
  { field: "sequenceNumber", header: "Sequence number", label: "Последовательный номер записи" },
  {
    field: "incomingRedirectingNumber",
    header: "Incoming redirecting number",
    label: "Входящий номер переадресующего",
  },
  {
    field: "outgoingRedirectingNumber",
    header: "Outgoing redirecting number",
    label: "Исходящий номер переадресующего",
  },
  {
    field: "radiusSessionId",
    header: "RADIUS Accounting-Session-Id",
    label: "RADIUS Accounting-Session-Id",
  },
  { field: "globalCallref", header: "Global Callref", label: "Глобальный Callref" },
  { field: "incomingNumplan", header: "Incoming numplan", label: "Входящий план нумерации" },
  { field: "outgoingNumplan", header: "Outgoing numplan", label: "Исходящий план нумерации" },
  { field: "uniqueTag", header: "UniqueTag identifier", label: "Идентификатор UniqueTag" },
  { field: "callingNai", header: "Calling NAI", label: "NAI вызывающего" },
  { field: "calledNai", header: "Called NAI", label: "NAI вызываемого" },
  {
    field: "incomingRedirectingNai",
    header: "Incoming redirecting NAI",
    label: "Входящий NAI переадресующего",
  },
  {
    field: "outgoingRedirectingNai",
    header: "Outgoing redirecting NAI",
    label: "Исходящий NAI переадресующего",
  },
  { field: "callTransferMark", header: "Call transfer mark", label: "Метка перевода вызова" },
  {
    field: "callRecordPath",
    header: "Call record path",
    label: "Адрес файла с записанным разговором",
  },
  {
    field: "ivrCallRecordPath",
    header: "IVR call record path",
    label: "Адрес файла с записанным IVR разговором",
  },
  {
    field: "rejectingRadiusAddress",
    header: "Rejecting RADIUS server address",
    label: "Адрес блокирующего RADIUS сервера",
  },
  {
    field: "callingNaiOriginal",
    header: "Calling NAI original",
    label: "Оригинальный NAI вызывающего",
  },
  {
    field: "calledNaiOriginal",
    header: "Called NAI original",
    label: "Оригинальный NAI вызываемого",
  },
  { field: "timeInQueue", header: "Time in queue", label: "Время в очереди" },
  { field: "redirectionType", header: "Redirection type", label: "Тип переадресации" },
] as const;

export type SmgField = (typeof SMG_COLUMNS)[number]["field"];

export const SMG_SHORT_HEADER_LENGTH = 50;

export const SMG_PHONE_FIELDS = [
  "incomingCgpn",
  "outgoingCgpn",
  "incomingCdpn",
  "outgoingCdpn",
] as const satisfies readonly SmgField[];

export const SMG_HEADER_LABELS: Record<SmgField, string> = Object.fromEntries(
  SMG_COLUMNS.map((column) => [column.field, column.label]),
) as Record<SmgField, string>;

export const SMG_FIELDS: readonly SmgField[] = SMG_COLUMNS.map(
  (column) => column.field,
);

const SHORT_HEADERS = SMG_COLUMNS.slice(0, SMG_SHORT_HEADER_LENGTH).map(
  (column) => column.header,
);
const FULL_HEADERS = SMG_COLUMNS.map((column) => column.header);

export function smgHeadersEqual(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (actual.length !== expected.length) return false;
  return actual.every((name, index) => name === expected[index]);
}

export function matchSmgHeader(
  headers: readonly string[],
): "short" | "full" | null {
  if (smgHeadersEqual(headers, FULL_HEADERS)) return "full";
  if (smgHeadersEqual(headers, SHORT_HEADERS)) return "short";
  return null;
}

export function emptySmgFields(): Record<SmgField, string> {
  const fields = {} as Record<SmgField, string>;
  for (const column of SMG_COLUMNS) fields[column.field] = "";
  return fields;
}

export function isSmgField(value: string): value is SmgField {
  return SMG_FIELDS.includes(value as SmgField);
}

/**
 * Call identity. A blank node still keys the row: the leading separator keeps
 * it apart from a call that names a node. Two blank-node calls with the same
 * tag, or the same sequence and setup time, are one call.
 */
export function smgRecordKey(fields: Record<SmgField, string>): string | null {
  const device = fields.deviceSign;
  if (fields.uniqueTag) return `${device}${KEY_SEP}${fields.uniqueTag}`;
  if (fields.sequenceNumber && fields.setupTime) {
    return `${device}${KEY_SEP}${fields.sequenceNumber}${KEY_SEP}${fields.setupTime}`;
  }
  return null;
}
