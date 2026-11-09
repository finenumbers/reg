import { asRecord } from "@/modules/vats/card";
import {
  catalogNames,
  compareDomains,
  compareTelnums,
  formatSubscribers,
  formatYesNo,
  showCell,
  type NamedId,
} from "@/modules/vats/labels";
import { parseDomainName, parseTelnum, safeLabel } from "@/modules/vats/names";

export type DomainRow = {
  name: string;
  client: string | null;
  clientAt: string | null;
  accountsCount: number | null;
  accountsLimit: number | null;
  dialplan: string | null;
  frozen: boolean | null;
};

export type TelnumRow = {
  telnum: string;
  domain: string | null;
  isFmc: boolean | null;
  gateways: string[];
};

export type SectionSnap<T> = {
  committed: boolean;
  notice: string | null;
  rows: T[];
};

export type CatalogSnap = {
  complete: boolean;
  notice: string | null;
  gateways: NamedId[];
  routes: string[];
  dialplans: NamedId[];
};

export type DomainTableRow = {
  name: string;
  client: string;
  subscribers: string;
  dialplan: string;
  frozen: string;
};

export type TelnumTableRow = {
  telnum: string;
  domain: string;
  domainHref: string | null;
  fmc: string;
  gateways: string;
};

export function emptyDomain(name: string): DomainRow {
  return {
    name,
    client: null,
    clientAt: null,
    accountsCount: null,
    accountsLimit: null,
    dialplan: null,
    frozen: null,
  };
}

export function emptyTelnum(telnum: string): TelnumRow {
  return { telnum, domain: null, isFmc: null, gateways: [] };
}

function noticeOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const notice = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if (!notice || notice.length > 300) return null;
  return notice;
}

function intOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
}

function clientAtOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  return value;
}

export function parseDomainSnap(value: unknown): SectionSnap<DomainRow> {
  if (Array.isArray(value)) {
    const rows: DomainRow[] = [];
    for (const item of value) {
      if (typeof item !== "string" || parseDomainName(item) !== item) continue;
      rows.push(emptyDomain(item));
    }
    return { committed: false, notice: null, rows };
  }
  const record = asRecord(value);
  if (!record || record.v !== 2 || !Array.isArray(record.rows)) {
    return { committed: false, notice: null, rows: [] };
  }
  const rows: DomainRow[] = [];
  for (const item of record.rows) {
    const row = asRecord(item);
    if (!row || typeof row.name !== "string" || parseDomainName(row.name) !== row.name)
      continue;
    const client = typeof row.client === "string" ? row.client : null;
    rows.push({
      name: row.name,
      client: client && client.length <= 500 ? client : null,
      clientAt: clientAtOrNull(row.clientAt),
      accountsCount: intOrNull(row.accountsCount),
      accountsLimit: intOrNull(row.accountsLimit),
      dialplan: typeof row.dialplan === "string" ? safeLabel(row.dialplan) : null,
      frozen: typeof row.frozen === "boolean" ? row.frozen : null,
    });
  }
  return {
    committed: record.committed === true,
    notice: noticeOrNull(record.notice),
    rows,
  };
}

export function parseTelnumSnap(value: unknown): SectionSnap<TelnumRow> {
  if (Array.isArray(value)) {
    const rows: TelnumRow[] = [];
    for (const item of value) {
      if (typeof item !== "string" || parseTelnum(item) !== item) continue;
      rows.push(emptyTelnum(item));
    }
    return { committed: false, notice: null, rows };
  }
  const record = asRecord(value);
  if (!record || record.v !== 2 || !Array.isArray(record.rows)) {
    return { committed: false, notice: null, rows: [] };
  }
  const rows: TelnumRow[] = [];
  for (const item of record.rows) {
    const row = asRecord(item);
    if (!row || typeof row.telnum !== "string" || parseTelnum(row.telnum) !== row.telnum)
      continue;
    const domain =
      typeof row.domain === "string" && parseDomainName(row.domain) === row.domain
        ? row.domain
        : null;
    const gateways: string[] = [];
    if (Array.isArray(row.gateways)) {
      for (const gateway of row.gateways) {
        if (typeof gateway !== "string") continue;
        const label = safeLabel(gateway);
        if (label) gateways.push(label);
      }
    }
    rows.push({
      telnum: row.telnum,
      domain,
      isFmc: typeof row.isFmc === "boolean" ? row.isFmc : null,
      gateways,
    });
  }
  return {
    committed: record.committed === true,
    notice: noticeOrNull(record.notice),
    rows,
  };
}

function namedList(value: unknown): NamedId[] {
  if (!Array.isArray(value)) return [];
  const rows: NamedId[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row || typeof row.name !== "string") continue;
    const name = safeLabel(row.name);
    const id = typeof row.id === "string" ? safeLabel(row.id) : name;
    if (!name || !id) continue;
    rows.push({ id, name });
  }
  return rows;
}

export function parseCatalogSnap(value: unknown): CatalogSnap {
  const record = asRecord(value);
  if (!record || record.v !== 2) {
    return { complete: false, notice: null, gateways: [], routes: [], dialplans: [] };
  }
  const routes: string[] = [];
  if (Array.isArray(record.routes)) {
    for (const item of record.routes) {
      if (typeof item !== "string") continue;
      const label = safeLabel(item);
      if (label) routes.push(label);
    }
  }
  return {
    complete: record.complete === true,
    notice: noticeOrNull(record.notice),
    gateways: namedList(record.gateways),
    routes,
    dialplans: namedList(record.dialplans),
  };
}

export function domainBody(snap: SectionSnap<DomainRow>): Record<string, unknown> {
  return { v: 2, committed: snap.committed, notice: snap.notice, rows: snap.rows };
}

export function telnumBody(snap: SectionSnap<TelnumRow>): Record<string, unknown> {
  return { v: 2, committed: snap.committed, notice: snap.notice, rows: snap.rows };
}

export function catalogBody(snap: CatalogSnap): Record<string, unknown> {
  return {
    v: 2,
    complete: snap.complete,
    notice: snap.notice,
    gateways: snap.gateways,
    routes: snap.routes,
    dialplans: snap.dialplans,
  };
}

export function visibleReadAt(committed: boolean, readAt: Date | null): string | null {
  if (!committed || !readAt) return null;
  return readAt.toISOString();
}

export function mergeDomainRows(
  previous: DomainRow[],
  incoming: DomainRow[],
  cardReadAt: Record<string, string>,
): DomainRow[] {
  const prev = new Map(previous.map((row) => [row.name, row]));
  return incoming.map((row) => {
    const old = prev.get(row.name);
    const readAt = cardReadAt[row.name];
    if (old?.clientAt && readAt && old.clientAt > readAt) {
      return { ...row, client: old.client, clientAt: old.clientAt };
    }
    return row;
  });
}

export function sortDomainRows(rows: DomainRow[]): DomainRow[] {
  return [...rows].sort((left, right) => compareDomains(left.name, right.name));
}

export function sortTelnumRows(rows: TelnumRow[]): TelnumRow[] {
  return [...rows].sort((left, right) => compareTelnums(left.telnum, right.telnum));
}

export function pageRows<T>(rows: T[], offset: number, size: number): T[] {
  if (offset < 0 || size < 1) return [];
  return rows.slice(offset, offset + size);
}

export function domainNames(rows: DomainRow[]): string[] {
  return rows.map((row) => row.name);
}

export function telnumNames(rows: TelnumRow[]): string[] {
  return rows.map((row) => row.telnum);
}

export function toDomainTable(row: DomainRow): DomainTableRow {
  return {
    name: row.name,
    client: showCell(row.client),
    subscribers: formatSubscribers(row.accountsCount, row.accountsLimit),
    dialplan: showCell(row.dialplan),
    frozen: formatYesNo(row.frozen),
  };
}

export function toTelnumTable(row: TelnumRow): TelnumTableRow {
  const domain =
    row.domain && parseDomainName(row.domain) === row.domain ? row.domain : null;
  return {
    telnum: row.telnum,
    domain: showCell(domain),
    domainHref: domain,
    fmc: formatYesNo(row.isFmc),
    gateways: row.gateways.length === 0 ? "—" : row.gateways.join(", "),
  };
}

export function settingsLists(snap: CatalogSnap): {
  gateways: string[];
  routes: string[];
  dialplans: string[];
} {
  return {
    gateways: catalogNames(snap.gateways),
    routes: snap.routes,
    dialplans: catalogNames(snap.dialplans),
  };
}
