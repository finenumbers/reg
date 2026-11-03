export const PCOMM_TABLE = "Транзитные вызовы (ПКомм)";
export const PUPR_TABLE = "Транзитные вызовы (ПУпр)";

export const PCOMM_FIELDS = {
  conferenceId: "Conference ID ПКомм",
  startedAt: "Время начала",
  connectedAt: "Время соединения",
  sourceSignal: "Адрес инициатора (сигн.)",
  outA: "Исходящий А-номер",
  outB: "Исходящий Б-номер",
  destSignal: "Адрес терм. устр-ва (сигн.)",
} as const;

export const PUPR_FIELDS = {
  conferenceId: "Conference ID ПКомм",
  state: "Состояние вызова",
  sourceName: "Имя инициатора",
  dialpeer: "Объект набора",
  destName: "Имя терм. устройства",
} as const;

export type PcommField = keyof typeof PCOMM_FIELDS;
export type PuprField = keyof typeof PUPR_FIELDS;

/** Live duration on the switching-subsystem page. Not a required column. */
export const TALK_DURATION_TITLE = "Время разговора";
/** Live duration on the routing page. The handbook names the unit. */
export const TALK_SECONDS_TITLE = "Время разговора, сек";

export const PCOMM_TALK_TITLES = [TALK_DURATION_TITLE, TALK_SECONDS_TITLE] as const;
export const PUPR_TALK_TITLES = [TALK_SECONDS_TITLE, TALK_DURATION_TITLE] as const;

export const LIVE_CALL_HEADERS = [
  { key: "state", header: "Состояние", bold: false },
  { key: "startedAt", header: "Время начала", bold: false },
  { key: "connectedAt", header: "Время соединения", bold: false },
  { key: "outA", header: "А-номер", bold: true },
  { key: "sideA", header: "Сторона A", bold: false },
  { key: "outB", header: "Б-номер", bold: true },
  { key: "sideB", header: "Сторона B", bold: false },
  { key: "seconds", header: "Секунды", bold: false },
  { key: "sourceName", header: "Инициирующее устройство", bold: false },
  { key: "destName", header: "Терминирующее устройство", bold: false },
  { key: "dialpeer", header: "Объект набора", bold: false },
  { key: "sourceSignal", header: "Инициатор", bold: false },
  { key: "destSignal", header: "Терминатор", bold: false },
] as const;

export type LiveCallColumnKey = (typeof LIVE_CALL_HEADERS)[number]["key"];

export function normalizeRtuLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
