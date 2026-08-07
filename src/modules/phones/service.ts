/**
 * Phones query service — local DB only.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  aggregateFacetItems,
  cellToFilterToken,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import { prisma } from "@/lib/db";
import { getJobRunSummary } from "@/modules/jobs/query";
import { applyJsonColumnFilters } from "@/modules/phones/json-filters";
import {
  isSipUnregistered,
  sipUnregisteredFilterPhones,
  toUnregisteredPhoneSet,
} from "@/modules/phones/sip-status";
import {
  ENDPOINT_HEADERS,
  ENDPOINT_NUMBER_FIELD,
  GATEWAY_HEADERS,
  REGISTRATION_FIELD,
  REGISTRATION_NO,
  REGISTRATION_YES,
  isEndpointPhoneKind,
  type PhoneKind,
  type PhoneRowData,
} from "@/modules/phones/types";

export type PhoneListItem = {
  id: string;
  name: string;
  endpointNumber: string | null;
  data: PhoneRowData;
  lastSyncedAt: string;
  /** Live SIP Unregistered from last regs.poll (reg_current). */
  sipUnregistered: boolean;
};

export type ListPhonesResult = {
  kind: PhoneKind;
  items: PhoneListItem[];
  headers: string[];
  total: number;
  page: number;
  pageSize: number;
  lastSyncedAt: string | null;
  endpointCount: number;
  gatewayCount: number;
  registeredCount: number;
  unregisteredCount: number;
  errorCount: number;
};

export type PhonesOperationalStatus = {
  lastJobStatus: "success" | "failed" | "running" | "never" | null;
  lastError: string | null;
  lastFinishedAt: string | null;
  lastFailedError: string | null;
  runningCount: number;
  endpointCount: number;
  gatewayCount: number;
  lastSyncedAt: string | null;
};

function asStringRecord(data: unknown): PhoneRowData {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out: PhoneRowData = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v == null) {
      out[k] = "";
    } else if (typeof v === "string") {
      out[k] = v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = String(v);
    } else {
      out[k] = "";
    }
  }
  return out;
}

function asStringArray(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const cleaned = value
    .map((h) => (typeof h === "string" ? h : ""))
    .filter((h) => h.length > 0);
  return cleaned.length > 0 ? cleaned : [...fallback];
}

function registrationEquals(value: string): Prisma.PhoneEndpointWhereInput {
  return {
    data: {
      path: [REGISTRATION_FIELD],
      equals: value,
    },
  };
}

/** Rows whose «Регистрация» is neither Да nor Нет (incl. Ошибка / missing). */
function registrationErrorWhere(): Prisma.PhoneEndpointWhereInput {
  return {
    AND: [
      { NOT: registrationEquals(REGISTRATION_YES) },
      { NOT: registrationEquals(REGISTRATION_NO) },
    ],
  };
}

function endpointKindWhere(kind: PhoneKind): Prisma.PhoneEndpointWhereInput {
  if (kind === "endpoints_registered") {
    return registrationEquals(REGISTRATION_YES);
  }
  if (kind === "endpoints_unregistered") {
    return registrationEquals(REGISTRATION_NO);
  }
  return registrationErrorWhere();
}

async function countRegistrationBuckets(): Promise<{
  registeredCount: number;
  unregisteredCount: number;
  errorCount: number;
}> {
  const [registeredCount, unregisteredCount, endpointTotal] = await Promise.all([
    prisma.phoneEndpoint.count({ where: registrationEquals(REGISTRATION_YES) }),
    prisma.phoneEndpoint.count({ where: registrationEquals(REGISTRATION_NO) }),
    prisma.phoneEndpoint.count(),
  ]);
  return {
    registeredCount,
    unregisteredCount,
    errorCount: Math.max(0, endpointTotal - registeredCount - unregisteredCount),
  };
}

function readCell(data: unknown, column: string): string {
  const record = asStringRecord(data);
  return record[column] ?? "";
}

function applyEndpointPhoneQ(
  base: Prisma.PhoneEndpointWhereInput,
  phoneQ: string,
): Prisma.PhoneEndpointWhereInput {
  const q = phoneQ.trim();
  if (!q) return base;
  return {
    AND: [
      base,
      {
        OR: [
          { endpointNumber: { contains: q, mode: "insensitive" } },
          {
            data: {
              path: [ENDPOINT_NUMBER_FIELD],
              string_contains: q,
            },
          },
        ],
      },
    ],
  };
}

async function loadUnregisteredSipPhones(): Promise<string[]> {
  const rows = await prisma.registrationCurrent.findMany({
    where: { status: "Unregistered" },
    select: { phone: true },
  });
  return rows.map((r) => r.phone);
}

/**
 * Restrict endpoints to SIP-Unregistered numbers.
 * Returns null when the Unregistered set is empty (caller should return empty).
 */
function applySipUnregisteredOnly(
  base: Prisma.PhoneEndpointWhereInput,
  unregisteredPhones: string[],
): Prisma.PhoneEndpointWhereInput | null {
  const phones = sipUnregisteredFilterPhones(unregisteredPhones);
  if (!phones) return null;
  return {
    AND: [base, { endpointNumber: { in: phones } }],
  };
}

async function unregisteredSetForEndpointRows(
  rows: { endpointNumber: string | null }[],
  knownSet: Set<string> | null,
): Promise<Set<string>> {
  if (knownSet) return knownSet;
  const numbers = rows
    .map((r) => r.endpointNumber)
    .filter((n): n is string => Boolean(n));
  if (numbers.length === 0) return new Set();
  const found = await prisma.registrationCurrent.findMany({
    where: { phone: { in: numbers }, status: "Unregistered" },
    select: { phone: true },
  });
  return toUnregisteredPhoneSet(found.map((r) => r.phone));
}

export async function listPhones(opts: {
  kind: PhoneKind;
  filters?: ColumnFilters;
  /** Substring search over «Номер оконечного оборудования» */
  phoneQ?: string;
  /** Only endpoints with live SIP Unregistered (endpoints_registered only). */
  sipUnregisteredOnly?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<ListPhonesResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 100));
  const filters = opts.filters ?? {};
  const phoneQ = opts.phoneQ?.trim() ?? "";
  const sipUnregisteredOnly =
    Boolean(opts.sipUnregisteredOnly) && opts.kind === "endpoints_registered";
  const skip = (page - 1) * pageSize;

  const [state, buckets] = await Promise.all([
    prisma.phoneImportState.findUnique({ where: { id: 1 } }),
    countRegistrationBuckets(),
  ]);

  const emptyMeta = {
    lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
    endpointCount: state?.endpointCount ?? 0,
    gatewayCount: state?.gatewayCount ?? 0,
    registeredCount: buckets.registeredCount,
    unregisteredCount: buckets.unregisteredCount,
    errorCount: buckets.errorCount,
  };

  if (isEndpointPhoneKind(opts.kind)) {
    let where = applyEndpointPhoneQ(
      applyJsonColumnFilters(
        endpointKindWhere(opts.kind),
        filters,
      ) as Prisma.PhoneEndpointWhereInput,
      phoneQ,
    );

    let knownUnregistered: Set<string> | null = null;
    if (sipUnregisteredOnly) {
      const unregisteredPhones = await loadUnregisteredSipPhones();
      knownUnregistered = toUnregisteredPhoneSet(unregisteredPhones);
      const filtered = applySipUnregisteredOnly(where, unregisteredPhones);
      if (!filtered) {
        return {
          kind: opts.kind,
          items: [],
          headers: asStringArray(state?.headersEndpoints, ENDPOINT_HEADERS),
          total: 0,
          page,
          pageSize,
          ...emptyMeta,
        };
      }
      where = filtered;
    }

    const [total, rows] = await Promise.all([
      prisma.phoneEndpoint.count({ where }),
      prisma.phoneEndpoint.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take: pageSize,
      }),
    ]);

    const unregSet =
      opts.kind === "endpoints_registered"
        ? await unregisteredSetForEndpointRows(rows, knownUnregistered)
        : null;

    return {
      kind: opts.kind,
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        endpointNumber: row.endpointNumber,
        data: asStringRecord(row.data),
        lastSyncedAt: row.lastSyncedAt.toISOString(),
        sipUnregistered: unregSet
          ? isSipUnregistered(row.endpointNumber, unregSet)
          : false,
      })),
      headers: asStringArray(state?.headersEndpoints, ENDPOINT_HEADERS),
      total,
      page,
      pageSize,
      ...emptyMeta,
    };
  }

  // Gateways have no endpoint number column — phone search yields empty set.
  if (phoneQ) {
    return {
      kind: "gateways",
      items: [],
      headers: asStringArray(state?.headersGateways, GATEWAY_HEADERS),
      total: 0,
      page,
      pageSize,
      ...emptyMeta,
    };
  }

  const where = applyJsonColumnFilters(
    {},
    filters,
  ) as Prisma.PhoneGatewayWhereInput;

  const [total, rows] = await Promise.all([
    prisma.phoneGateway.count({ where }),
    prisma.phoneGateway.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    kind: "gateways",
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      endpointNumber: null,
      data: asStringRecord(row.data),
      lastSyncedAt: row.lastSyncedAt.toISOString(),
      sipUnregistered: false,
    })),
    headers: asStringArray(state?.headersGateways, GATEWAY_HEADERS),
    total,
    page,
    pageSize,
    lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
    endpointCount: state?.endpointCount ?? 0,
    gatewayCount: state?.gatewayCount ?? total,
    registeredCount: buckets.registeredCount,
    unregisteredCount: buckets.unregisteredCount,
    errorCount: buckets.errorCount,
  };
}

export async function listPhoneFacets(opts: {
  kind: PhoneKind;
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  sipUnregisteredOnly?: boolean;
  q?: string;
  limit?: number;
}): Promise<FacetResponse> {
  const column = opts.column.trim();
  if (!column) {
    return { items: [], truncated: false };
  }

  const filters = opts.filters ?? {};
  const phoneQ = opts.phoneQ?.trim() ?? "";
  const sipUnregisteredOnly =
    Boolean(opts.sipUnregisteredOnly) && opts.kind === "endpoints_registered";

  if (isEndpointPhoneKind(opts.kind)) {
    let where = applyEndpointPhoneQ(
      applyJsonColumnFilters(endpointKindWhere(opts.kind), filters, {
        excludeColumn: column,
      }) as Prisma.PhoneEndpointWhereInput,
      phoneQ,
    );

    if (sipUnregisteredOnly) {
      const unregisteredPhones = await loadUnregisteredSipPhones();
      const filtered = applySipUnregisteredOnly(where, unregisteredPhones);
      if (!filtered) {
        return { items: [], truncated: false };
      }
      where = filtered;
    }

    const rows = await prisma.phoneEndpoint.findMany({
      where,
      select: { data: true },
    });
    return aggregateFacetItems(
      rows.map((r) => cellToFilterToken(readCell(r.data, column))),
      { q: opts.q, limit: opts.limit },
    );
  }

  if (phoneQ) {
    return { items: [], truncated: false };
  }

  const where = applyJsonColumnFilters({}, filters, {
    excludeColumn: column,
  }) as Prisma.PhoneGatewayWhereInput;

  const rows = await prisma.phoneGateway.findMany({
    where,
    select: { data: true },
  });
  return aggregateFacetItems(
    rows.map((r) => cellToFilterToken(readCell(r.data, column))),
    { q: opts.q, limit: opts.limit },
  );
}

export async function getPhonesOperationalStatus(): Promise<PhonesOperationalStatus> {
  const [summary, state] = await Promise.all([
    getJobRunSummary("phones.sync"),
    prisma.phoneImportState.findUnique({ where: { id: 1 } }),
  ]);

  const lastAny = summary.lastAny;
  let lastJobStatus: PhonesOperationalStatus["lastJobStatus"] = "never";
  if (lastAny) {
    lastJobStatus = lastAny.status;
  }

  return {
    lastJobStatus,
    lastError:
      lastAny?.status === "failed"
        ? (lastAny.errorMessage ?? "Sync failed")
        : (summary.lastFailed?.errorMessage ?? null),
    lastFinishedAt: lastAny?.finishedAt ?? lastAny?.startedAt ?? null,
    lastFailedError: summary.lastFailed?.errorMessage ?? null,
    runningCount: summary.runningCount,
    endpointCount: state?.endpointCount ?? 0,
    gatewayCount: state?.gatewayCount ?? 0,
    lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
  };
}
