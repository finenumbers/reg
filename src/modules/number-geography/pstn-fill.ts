/**
 * Fill pstn_phone_cache for geography rows that have never been looked up.
 * Does not refresh a row that is already stored, and does not prune the cache.
 * The same table is what CDR import, month export, and CSV enrich read.
 */

import PQueue from "p-queue";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PstnLookupError, lookupPstnPhone } from "@/modules/pstn/client";
import {
  loadPstnCacheByPhones,
  upsertPstnCache,
  type CachedPstn,
} from "@/modules/pstn/cache";
import { loadPstnCredentials } from "@/modules/pstn/credentials";
import {
  PSTN_LOOKUP_CONCURRENCY,
  normalizePstnPhone,
  type PstnCredentials,
  type PstnFields,
} from "@/modules/pstn/types";
import {
  type PstnFillItem,
  type PstnFillResponse,
} from "@/modules/number-geography/pstn-fill-contract";
import {
  pstnLabelsByIdsSql,
  pstnLabelsForNumbersSql,
} from "@/modules/number-geography/sql";

export const PSTN_FILL_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
export const PSTN_FILL_AUTH_BLOCK_MS = 10 * 60 * 1000;
export const PSTN_FILL_NET_BLOCK_MS = 60 * 1000;
export const PSTN_FILL_MAX_RETRY_WAIT_MS = 2_000;
const NET_STRIKES_TO_BLOCK = 3;

export type PstnFillEndpoint = { id: string; number: string };
export type PstnFillLabel = { id: string; operator: string; geography: string };

export type PstnFillDeps = {
  loadCredentials: () => Promise<PstnCredentials | null>;
  loadEndpoints: (ids: string[]) => Promise<PstnFillEndpoint[]>;
  loadCache: (phones: string[]) => Promise<Map<string, CachedPstn>>;
  lookup: (phone: string, creds: PstnCredentials) => Promise<PstnFields>;
  upsert: (phone: string, fields: PstnFields) => Promise<void>;
  loadLabels: (ids: string[]) => Promise<PstnFillLabel[]>;
};

type LookupOutcome = "filled" | "error";

let queue = new PQueue({ concurrency: PSTN_LOOKUP_CONCURRENCY });
const inflight = new Map<string, Promise<LookupOutcome>>();
const cooldownUntil = new Map<string, number>();
let authBlockedUntil = 0;
let netBlockedUntil = 0;
let consecutiveNetFailures = 0;
let nowFn: () => Date = () => new Date();
let sleepFn: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function resetPstnFillForTests(opts?: {
  concurrency?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}): void {
  queue = new PQueue({
    concurrency: opts?.concurrency ?? PSTN_LOOKUP_CONCURRENCY,
  });
  inflight.clear();
  cooldownUntil.clear();
  authBlockedUntil = 0;
  netBlockedUntil = 0;
  consecutiveNetFailures = 0;
  nowFn = opts?.now ?? (() => new Date());
  sleepFn =
    opts?.sleep ??
    ((ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));
}

function nowMs(): number {
  return nowFn().getTime();
}

function blocked(): boolean {
  const now = nowMs();
  if (authBlockedUntil > now) return true;
  if (netBlockedUntil > now) return true;
  if (netBlockedUntil !== 0 && netBlockedUntil <= now) {
    netBlockedUntil = 0;
    consecutiveNetFailures = 0;
  }
  return false;
}

function cooledDown(phone: string): boolean {
  const until = cooldownUntil.get(phone);
  if (until == null) return false;
  if (until <= nowMs()) {
    cooldownUntil.delete(phone);
    return false;
  }
  return true;
}

function noteFailure(phone: string, error: unknown): void {
  const code = error instanceof PstnLookupError ? error.code : "NETWORK";
  cooldownUntil.set(phone, nowMs() + PSTN_FILL_FAILURE_COOLDOWN_MS);
  logger.warn("number_geography.pstn_fill_failed", { code });
  if (code === "UNAUTHORIZED") {
    authBlockedUntil = nowMs() + PSTN_FILL_AUTH_BLOCK_MS;
    return;
  }
  if (code === "TIMEOUT" || code === "NETWORK" || code === "NOT_READY") {
    consecutiveNetFailures += 1;
    if (consecutiveNetFailures >= NET_STRIKES_TO_BLOCK) {
      netBlockedUntil = nowMs() + PSTN_FILL_NET_BLOCK_MS;
    }
  }
}

async function runLookup(
  phone: string,
  creds: PstnCredentials,
  deps: PstnFillDeps,
): Promise<LookupOutcome> {
  if (blocked() || cooledDown(phone)) return "error";
  try {
    const fields = await deps.lookup(phone, creds);
    await deps.upsert(phone, fields);
    consecutiveNetFailures = 0;
    return "filled";
  } catch (error) {
    if (error instanceof PstnLookupError && error.code === "RATE_LIMITED") {
      const waitMs = (error.retryAfterSec ?? 2) * 1000;
      if (waitMs <= PSTN_FILL_MAX_RETRY_WAIT_MS) {
        await sleepFn(waitMs);
        if (!blocked()) {
          try {
            const fields = await deps.lookup(phone, creds);
            await deps.upsert(phone, fields);
            consecutiveNetFailures = 0;
            return "filled";
          } catch (retryError) {
            noteFailure(phone, retryError);
            return "error";
          }
        }
      }
    }
    noteFailure(phone, error);
    return "error";
  }
}

function lookupOnce(
  phone: string,
  creds: PstnCredentials,
  deps: PstnFillDeps,
): Promise<LookupOutcome> {
  if (blocked() || cooledDown(phone)) return Promise.resolve("error");
  const existing = inflight.get(phone);
  if (existing) return existing;
  const promise = queue
    .add(() => runLookup(phone, creds, deps))
    .finally(() => {
      if (inflight.get(phone) === promise) inflight.delete(phone);
    });
  inflight.set(phone, promise);
  return promise;
}

function splitPstnIds(ids: readonly string[]): { endpoints: string[]; did: string[] } {
  const endpoints: string[] = [];
  const did: string[] = [];
  for (const id of ids) {
    if (id.startsWith("did:")) did.push(id);
    else endpoints.push(id);
  }
  return { endpoints, did };
}

async function endpointNumbers(ids: readonly string[]): Promise<PstnFillEndpoint[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.phoneEndpoint.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, endpointNumber: true },
  });
  return rows.flatMap((row) => {
    const number = row.endpointNumber?.trim() ?? "";
    return number === "" ? [] : [{ id: row.id, number }];
  });
}

async function didNumbers(ids: readonly string[]): Promise<PstnFillEndpoint[]> {
  if (ids.length === 0) return [];
  const state = await prisma.geographyDidState.findUnique({
    where: { id: 1 },
    select: { generation: true },
  });
  if (!state) return [];
  const rows = await prisma.geographyDidSource.findMany({
    where: { generation: state.generation, rowId: { in: [...ids] } },
    select: { rowId: true, displayNumber: true },
  });
  return rows.flatMap((row) => {
    const number = row.displayNumber.trim();
    return number === "" ? [] : [{ id: row.rowId, number }];
  });
}

async function numbersForPstnFill(ids: readonly string[]): Promise<PstnFillEndpoint[]> {
  const parts = splitPstnIds(ids);
  const [endpoints, did] = await Promise.all([
    endpointNumbers(parts.endpoints),
    didNumbers(parts.did),
  ]);
  return [...endpoints, ...did];
}

const defaultDeps: PstnFillDeps = {
  loadCredentials: loadPstnCredentials,
  loadEndpoints: numbersForPstnFill,
  loadCache: loadPstnCacheByPhones,
  lookup: lookupPstnPhone,
  upsert: upsertPstnCache,
  async loadLabels(ids) {
    if (ids.length === 0) return [];
    const parts = splitPstnIds(ids);
    const [endpointRows, didPairs] = await Promise.all([
      parts.endpoints.length === 0
        ? Promise.resolve([])
        : prisma.$queryRaw<
            { id: string; operator: string | null; geography: string | null }[]
          >(pstnLabelsByIdsSql(parts.endpoints)),
      didNumbers(parts.did),
    ]);
    const didRows =
      didPairs.length === 0
        ? []
        : await prisma.$queryRaw<
            { id: string; operator: string | null; geography: string | null }[]
          >(pstnLabelsForNumbersSql(didPairs));
    return [...endpointRows, ...didRows].map((row) => ({
      id: row.id,
      operator: row.operator ?? "",
      geography: row.geography ?? "",
    }));
  },
};

export async function fillNumberGeographyPstn(
  ids: string[],
  deps: PstnFillDeps = defaultDeps,
): Promise<PstnFillResponse> {
  const uniqueIds = [...new Set(ids)];
  const creds = await deps.loadCredentials();
  if (!creds) {
    logger.info("number_geography.pstn_fill", {
      requested: uniqueIds.length,
      configured: false,
    });
    return { configured: false };
  }

  const endpoints = await deps.loadEndpoints(uniqueIds);
  const numberById = new Map(endpoints.map((row) => [row.id, row.number]));
  const slots = uniqueIds.map((id) => {
    const number = numberById.get(id);
    const phone = number == null ? null : normalizePstnPhone(number);
    return { id, phone };
  });
  const phones = [...new Set(slots.flatMap((slot) => (slot.phone ? [slot.phone] : [])))];
  const cache = phones.length > 0 ? await deps.loadCache(phones) : new Map();

  const outcome = new Map<string, "cached" | LookupOutcome>();
  const missing: string[] = [];
  for (const phone of phones) {
    if (cache.has(phone)) outcome.set(phone, "cached");
    else missing.push(phone);
  }
  const lookedUp = await Promise.all(
    missing.map(async (phone) => {
      const status = await lookupOnce(phone, creds, deps);
      return [phone, status] as const;
    }),
  );
  for (const [phone, status] of lookedUp) outcome.set(phone, status);

  const labelIds = slots
    .filter((slot) => {
      if (!slot.phone) return false;
      const status = outcome.get(slot.phone);
      return status === "cached" || status === "filled";
    })
    .map((slot) => slot.id);
  const labels = labelIds.length > 0 ? await deps.loadLabels(labelIds) : [];
  const labelById = new Map(labels.map((label) => [label.id, label]));

  let invalid = 0;
  let cached = 0;
  let filled = 0;
  let failed = 0;
  const items: PstnFillItem[] = slots.map((slot) => {
    if (!slot.phone) {
      invalid += 1;
      return { id: slot.id, status: "invalid" };
    }
    const status = outcome.get(slot.phone) ?? "error";
    if (status === "cached" || status === "filled") {
      const label = labelById.get(slot.id);
      if (!label) {
        failed += 1;
        return { id: slot.id, status: "error" };
      }
      if (status === "cached") cached += 1;
      else filled += 1;
      return {
        id: slot.id,
        status,
        operator: label.operator,
        geography: label.geography,
      };
    }
    failed += 1;
    return { id: slot.id, status: "error" };
  });

  logger.info("number_geography.pstn_fill", {
    requested: uniqueIds.length,
    invalid,
    cached,
    filled,
    failed,
  });
  return { configured: true, items };
}
