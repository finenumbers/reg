import { parseDomainName, safeLabel } from "@/modules/vats/names";

export type VatsDomainCard = {
  name: string;
  client: string | null;
  language: string | null;
  clientEditable: boolean;
  languageEditable: boolean;
  billingType: "demo" | "billable" | null;
  frozen: boolean | null;
  ownRegion: string | null;
  accountsLimit: number | null;
  accountsCount: number | null;
  extDigits: number | null;
  sysdomain: boolean | null;
};

export type VatsTelnumCard = {
  telnum: string;
  gateways: string[];
  allocatedTo: string | null;
  isFmc: boolean | null;
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/** View fields only. accessURL, dialplan, route, and services stay on the server. */
export function domainCardView(
  domain: string,
  raw: Record<string, unknown>,
): VatsDomainCard {
  const name = textOrNull(raw.name);
  return {
    name: name && parseDomainName(name) === name ? name : domain,
    client: textOrNull(raw.client),
    language: textOrNull(raw.language),
    clientEditable: raw.client == null || typeof raw.client === "string",
    languageEditable: raw.language == null || typeof raw.language === "string",
    billingType:
      raw.billingType === "demo" || raw.billingType === "billable"
        ? raw.billingType
        : null,
    frozen: typeof raw.frozen === "boolean" ? raw.frozen : null,
    ownRegion: textOrNull(raw.ownRegion),
    accountsLimit: numberOrNull(raw.accountsLimit),
    accountsCount: numberOrNull(raw.accountsCount),
    extDigits: numberOrNull(raw.extDigits),
    sysdomain: typeof raw.sysdomain === "boolean" ? raw.sysdomain : null,
  };
}

export type DomainStatFields = {
  recordDays: number | null;
  speechMinutes: number | null;
};

function safeCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/** Two integers only. The rest of the statistics object stays on the server. */
export function domainStatFields(raw: Record<string, unknown>): DomainStatFields {
  const speech = asRecord(raw.speechAnalytics);
  return {
    recordDays: safeCount(raw.recordExpirationDays),
    speechMinutes: speech ? safeCount(speech.thisMonth) : null,
  };
}

export function telnumCardView(
  telnum: string,
  raw: Record<string, unknown>,
): VatsTelnumCard {
  const gateways: string[] = [];
  if (Array.isArray(raw.gateways)) {
    for (const item of raw.gateways) {
      if (typeof item !== "string") continue;
      const label = safeLabel(item);
      if (label) gateways.push(label);
    }
  }
  return {
    telnum,
    gateways,
    allocatedTo: textOrNull(raw.allocatedTo),
    isFmc: typeof raw.isFmc === "boolean" ? raw.isFmc : null,
  };
}

export function parseCatalog(data: unknown): string[] | null {
  if (!Array.isArray(data)) return null;
  const labels: string[] = [];
  for (const item of data) {
    if (typeof item === "string") {
      const label = safeLabel(item);
      if (label) labels.push(label);
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const raw =
      typeof record.name === "string" && record.name.trim()
        ? record.name
        : typeof record.id === "string"
          ? record.id
          : "";
    const label = safeLabel(raw);
    if (label) labels.push(label);
  }
  return labels;
}
