/**
 * Numbers on one sync card. The catalog is not counted here.
 * A live purchased or free cell comes from the stage of the current run.
 * «Разобрано» comes from the counters stored with the mask cursor.
 */

import { msUntilNextUtcHour } from "@/modules/numbering-chain/cadence";

export type SidePhase = "idle" | "reading" | "done";

export type ProviderKey =
  | "sipout"
  | "runexis"
  | "uis"
  | "aurora"
  | "exolve"
  | "voximplant"
  | "mcn"
  | "finenumbers";

export type ParsedProvider = {
  epoch: number;
  done: number;
  parsed: number;
};

export type ParsedSnapshot = {
  maskEpoch: number;
  maskDone: number;
  providers: Record<ProviderKey, ParsedProvider>;
};

const PROVIDER_KEYS: readonly ProviderKey[] = [
  "sipout",
  "runexis",
  "uis",
  "aurora",
  "exolve",
  "voximplant",
  "mcn",
  "finenumbers",
];

export function emptyParsed(): ParsedSnapshot {
  const providers = {} as Record<ProviderKey, ParsedProvider>;
  for (const key of PROVIDER_KEYS) {
    providers[key] = { epoch: 0, done: 0, parsed: 0 };
  }
  return { maskEpoch: 0, maskDone: 0, providers };
}

export function asCardInt(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

export function asCardDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value !== "") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

/** Copies that were not stored. A negative or unsafe input is zero. */
export function safeDropped(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

/** Duplicates inside one response, plus copies the draft did not insert. */
export function droppedCopies(received: number, unique: number, inserted: number): number {
  const inResponse = received > unique ? received - unique : 0;
  const already = unique > inserted ? unique - inserted : 0;
  return inResponse + already;
}

export function liveCount(
  busy: boolean,
  phase: SidePhase,
  last: number | null,
  staged: number,
): number | null {
  if (!busy || phase === "idle") return last;
  if (phase === "reading" && staged <= 0) return last;
  return staged;
}

/** SipOut. `check` and `cities` keep both previous numbers. */
export function sipoutPhases(
  step: string | null,
  phase: string,
): { purchased: SidePhase; free: SidePhase } {
  if (phase === "publishing" || step === "publishing" || step === "split") {
    return { purchased: "done", free: "done" };
  }
  if (step === "free") return { purchased: "done", free: "reading" };
  if (step === "purchased") return { purchased: "reading", free: "idle" };
  return { purchased: "idle", free: "idle" };
}

/**
 * Sources whose list moves from purchased to free.
 * An empty list is the access check and keeps both previous numbers.
 */
export function listPhases(
  list: string,
  phase: string,
): { purchased: SidePhase; free: SidePhase } {
  if (phase === "publishing") return { purchased: "done", free: "done" };
  if (list === "free" || list === "showcase") {
    return { purchased: "done", free: "reading" };
  }
  if (list === "purchased" || list === "management") {
    return { purchased: "reading", free: "idle" };
  }
  return { purchased: "idle", free: "idle" };
}

/**
 * Aurora writes the free draft once, after every link.
 * `list` is already `free` during the download, so an empty draft stays on the previous number.
 */
export function auroraFreeCount(
  busy: boolean,
  last: number | null,
  staged: number,
): number | null {
  if (!busy || staged <= 0) return last;
  return staged;
}

export function shownNumbers(input: {
  kind: "sipout" | "list" | "aurora";
  busy: boolean;
  step: string | null;
  list: string;
  phase: string;
  lastFree: number | null;
  lastPurchased: number | null;
  stagedFree: number;
  stagedPurchased: number;
}): { freeShown: number | null; purchasedShown: number | null } {
  if (input.kind === "aurora") {
    return {
      purchasedShown: null,
      freeShown: auroraFreeCount(input.busy, input.lastFree, input.stagedFree),
    };
  }
  const phases =
    input.kind === "sipout"
      ? sipoutPhases(input.step, input.phase)
      : listPhases(input.list, input.phase);
  return {
    purchasedShown: liveCount(
      input.busy,
      phases.purchased,
      input.lastPurchased,
      input.stagedPurchased,
    ),
    freeShown: liveCount(input.busy, phases.free, input.lastFree, input.stagedFree),
  };
}

/**
 * Settled cards use the last written totals, so a fresh zero column does not wipe them.
 * An open mask debt shows the counters, including zero through the tariff pass.
 */
export function parsedShown(
  snapshot: ParsedSnapshot,
  key: ProviderKey,
  free: number | null,
  purchased: number | null,
): number | null {
  const row = snapshot.providers[key];
  if (snapshot.maskEpoch > snapshot.maskDone) return row.parsed;
  if (row.epoch > row.done) return row.parsed;
  if (key === "aurora") return free;
  if (free == null && purchased == null) return null;
  return (free ?? 0) + (purchased ?? 0);
}

/** `HH:mm, dd.MM.yyyy` in the operator zone. The browser zone is not used. */
export function formatSyncStamp(value: Date | null, timeZone: string): string {
  if (value == null || Number.isNaN(value.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const hour = part("hour");
  const minute = part("minute");
  const day = part("day");
  const month = part("month");
  const year = part("year");
  if (!hour || !minute || !day || !month || !year) return "—";
  return `${hour}:${minute}, ${day}.${month}.${year}`;
}

/** Next 22:00 UTC, drawn in the operator zone. */
export function nextChainLabel(now: Date, timeZone: string): string {
  return formatSyncStamp(new Date(now.getTime() + msUntilNextUtcHour(now)), timeZone);
}

export function formatCount(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function cardLabels(input: {
  kind: "sipout" | "list" | "aurora";
  busy: boolean;
  step: string | null;
  list: string;
  phase: string;
  lastFree: number | null;
  lastPurchased: number | null;
  stagedFree: unknown;
  stagedPurchased: unknown;
  duplicates: unknown;
  loadedAt: unknown;
  timeZone: string;
}): {
  freeShown: number | null;
  purchasedShown: number | null;
  duplicates: number;
  loadedAtLabel: string;
} {
  const shown = shownNumbers({
    kind: input.kind,
    busy: input.busy,
    step: input.step,
    list: input.list,
    phase: input.phase,
    lastFree: input.lastFree,
    lastPurchased: input.lastPurchased,
    stagedFree: asCardInt(input.stagedFree),
    stagedPurchased: asCardInt(input.stagedPurchased),
  });
  return {
    ...shown,
    duplicates: asCardInt(input.duplicates),
    loadedAtLabel: formatSyncStamp(asCardDate(input.loadedAt), input.timeZone),
  };
}
