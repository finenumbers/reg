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

export const LIVE_CALL_HEADERS = [
  { key: "state", header: "Состояние вызова", bold: false },
  { key: "startedAt", header: "Время начала", bold: false },
  { key: "connectedAt", header: "Время соединения", bold: false },
  { key: "outA", header: "Исходящий А-номер", bold: true },
  { key: "outB", header: "Исходящий Б-номер", bold: true },
  { key: "sourceName", header: "Имя инициатора", bold: false },
  { key: "sourceSignal", header: "Адрес инициатора (сигнальный)", bold: false },
  { key: "destName", header: "Имя терминирующего устройства", bold: false },
  { key: "destSignal", header: "Адрес терминирующего устройства (сигнальный)", bold: false },
  { key: "dialpeer", header: "Объект набора", bold: false },
] as const;

export type LiveCallColumnKey = (typeof LIVE_CALL_HEADERS)[number]["key"];

export function normalizeRtuLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
