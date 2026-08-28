export const MISSING_LABEL = "Нет данных";
export const MISSING_BILLING_LABEL = "Нет в биллинге";
export const MISSING_PSTN_LABEL = "Нет в реестре МинЦифры";

export const EXCEL_MAX_ROWS = 1_048_575;
export const ENRICH_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const ENRICH_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;

export const TRAFFIC_HEADERS = [
  "Время звонка",
  "А-номер",
  "Сторона А",
  "В-номер",
  "Сторона В",
  "Секунды",
  "Минуты",
  "Тариф",
  "Стоимость",
  "Инициирующее устройство",
  "Терминирующее устройство",
  "Объект набора",
  "Код завершения",
] as const;

export const DETAIL_HEADERS = [
  "Время звонка",
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
  18.5, 15.1640625, 41.1640625, 15.1640625, 41.1640625, 13.83203125,
  13.1640625, 11.33203125, 15.33203125, 31.5, 32.5, 33.5, 37.5,
];

export const DETAIL_WIDTHS = [
  18.5, 15.1640625, 41.1640625, 29.83203125, 29.83203125, 15.1640625,
  41.1640625, 29.83203125, 29.83203125, 13.83203125, 31.5, 32.5, 33.5, 37.5,
  20.5, 13.5, 21.1640625, 32.33203125, 18.5, 13.5, 21.1640625, 32.33203125,
];

export type EnrichStageId =
  | "parse"
  | "phones"
  | "pstn"
  | "geoip"
  | "xlsx"
  | "download";

export type EnrichStageStatus = "pending" | "running" | "done" | "error";

export type EnrichStageView = {
  id: EnrichStageId;
  label: string;
  status: EnrichStageStatus;
  current?: number;
  total?: number;
  detail?: string;
};

export const INITIAL_STAGES: EnrichStageView[] = [
  { id: "parse", label: "Загрузка и разбор CSV", status: "pending" },
  {
    id: "phones",
    label: "Сторона А/B из «Телефонные номера»",
    status: "pending",
  },
  { id: "pstn", label: "PSTN: оператор и география", status: "pending" },
  {
    id: "geoip",
    label: "GeoIP: страна / город / провайдер",
    status: "pending",
  },
  { id: "xlsx", label: "Формирование XLSX", status: "pending" },
  { id: "download", label: "Скачивание", status: "pending" },
];

export type EnrichSummary = {
  rows: number;
  badLines: number;
  uniquePhones: number;
  uniqueIps: number;
  descriptionFound: number;
  descriptionMissing: number;
  pstnFound: number;
  pstnMissing: number;
  pstnCacheHits: number;
  pstnLiveLookups: number;
  geoipLookedUp: number;
  geoipCacheHits: number;
  geoipLiveLookups: number;
  outputFilename: string;
};

export type CdrJsonlRow = {
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
  initIp: string | null;
  termIp: string | null;
};

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
};

export type EnrichJobView = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  sourceFilename: string;
  stages: EnrichStageView[];
  summary: EnrichSummary | null;
  errorMessage: string | null;
  downloadUrl: string | null;
};

export function isResumableEnrichJob(
  job: Pick<EnrichJobView, "status"> | null,
): boolean {
  return job != null && (job.status === "queued" || job.status === "running");
}

export function isFinishedEnrichJob(
  job: Pick<EnrichJobView, "status"> | null,
): boolean {
  return job != null && (job.status === "completed" || job.status === "failed");
}

/** Mark in-flight / pending stages as error (orphan reclaim, pipeline catch). */
export function failOpenEnrichStages(
  stages: EnrichStageView[],
  detail: string,
): EnrichStageView[] {
  return stages.map((stage) =>
    stage.status === "done" || stage.status === "error"
      ? stage
      : { ...stage, status: "error", detail },
  );
}

export function billableMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
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
