export const MISSING_BILLING_LABEL = "-";
export const MISSING_PSTN_LABEL = "Нет в реестре МинЦифры";

export const EXCEL_MAX_ROWS = 1_048_575;

export const TRAFFIC_HEADERS = [
  "Дата",
  "Время",
  "Категория",
  "Тип",
  "Статус",
  "А-номер",
  "Сторона А",
  "В-номер",
  "Сторона В",
  "Направление",
  "Секунды",
  "Минуты",
  "Цена",
  "Стоимость",
  "Инициирующее устройство",
  "Терминирующее устройство",
  "Объект набора",
  "Код завершения",
] as const;

export const DETAIL_HEADERS = [
  "Дата",
  "Время",
  "Категория",
  "Тип",
  "Статус",
  "A-номер",
  "Сторона A",
  "Оператор A",
  "География A",
  "B-номер",
  "Сторона B",
  "Оператор B",
  "География B",
  "Секунды",
  "Инициирующее устройство",
  "Терминирующее устройство",
  "Объект набора",
  "Код завершения",
  "Инициирование",
  "Страна A",
  "Город A",
  "Провайдер A",
  "Терминация",
  "Страна B",
  "Город B",
  "Провайдер B",
] as const;

export const TRAFFIC_WIDTHS = [
  12, 11.5703125, 22, 18, 14, 15.140625, 41.140625, 15.140625, 41.140625,
  41.140625, 13.85546875, 13.140625, 11.28515625, 15.28515625, 31.42578125,
  32.42578125, 33.42578125, 37.42578125,
];

export const DETAIL_WIDTHS = [
  12, 10, 22, 18, 14, 15.1640625, 41.1640625, 29.83203125, 29.83203125,
  15.1640625, 41.1640625, 29.83203125, 29.83203125, 13.83203125, 31.5, 32.5,
  33.5, 37.5, 20.5, 13.5, 21.1640625, 32.33203125, 18.5, 13.5, 21.1640625,
  32.33203125,
];

/** Per-row values already resolved (month export snapshot). */
export type ResolvedEnrichedRow = {
  time: string;
  aNumber: string;
  bNumber: string;
  seconds: number;
  initDevice: string;
  termDevice: string;
  dialObject: string;
  cause: string;
  initEndpoint: string;
  termEndpoint: string;
  sideA: string;
  sideB: string;
  /** Raw softswitch ms. Missing is not empty duration for row fill. */
  elapsedTime?: string;
  operatorA: string;
  geographyA: string;
  operatorB: string;
  geographyB: string;
  countryA: string;
  cityA: string;
  providerA: string;
  countryB: string;
  cityB: string;
  providerB: string;
  /** Stored catalog direction. Empty when the call is not rated. */
  tariffDirection?: string;
  /** Catalog per-minute price, formatTariffDecimal text. */
  tariffPrice?: string;
  tariffCharge?: string;
};

/** Ceiled seconds at or below this stay 0 minutes. The SQL rater uses the same bound. */
export const MINUTE_GRACE_SECONDS = 3;

/** Per-call minutes from ceiled seconds. 0–3 seconds are 0; otherwise CEIL(seconds / 60). */
export function billableMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= MINUTE_GRACE_SECONDS) return 0;
  return Math.ceil(seconds / 60);
}

export function stripIpPort(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const host = trimmed.includes(":") ? trimmed.slice(0, trimmed.lastIndexOf(":")) : trimmed;
  return host || null;
}

export function descriptionOrMissing(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : MISSING_BILLING_LABEL;
}

export function pstnOrMissing(
  fields: { found: boolean; operator: string | null; garTerritory: string | null } | undefined,
): { operator: string; geography: string; missing: boolean } {
  if (!fields?.found || !fields.operator) {
    return {
      operator: MISSING_PSTN_LABEL,
      geography: MISSING_PSTN_LABEL,
      missing: true,
    };
  }
  return {
    operator: fields.operator,
    geography: fields.garTerritory?.trim() || MISSING_PSTN_LABEL,
    missing: false,
  };
}
