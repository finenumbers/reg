/**
 * «Разобрано» is the rows of one source at or before the decorate cursor.
 * The pass name carries the side. A batch adds only while that name matches.
 * The page counts the catalog only while the stored name is still the old one.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ParsedSnapshot, ProviderKey } from "@/modules/numbering-sync/card-numbers";

/** Same order as PROVIDERS in decorate.ts. The first open epoch is the one walking. */
const SOURCES = [
  {
    name: "SipOut",
    key: "sipout",
    parsed: "sipout_parsed",
    epoch: "sipout_epoch",
    done: "sipout_done",
  },
  {
    name: "Runexis",
    key: "runexis",
    parsed: "runexis_parsed",
    epoch: "runexis_epoch",
    done: "runexis_done",
  },
  { name: "UIS", key: "uis", parsed: "uis_parsed", epoch: "uis_epoch", done: "uis_done" },
  {
    name: "Aurora Telecom",
    key: "aurora",
    parsed: "aurora_parsed",
    epoch: "aurora_epoch",
    done: "aurora_done",
  },
  {
    name: "MTS Exolve",
    key: "exolve",
    parsed: "exolve_parsed",
    epoch: "exolve_epoch",
    done: "exolve_done",
  },
  {
    name: "Voximplant",
    key: "voximplant",
    parsed: "voximplant_parsed",
    epoch: "voximplant_epoch",
    done: "voximplant_done",
  },
  {
    name: "MCN Telecom",
    key: "mcn",
    parsed: "mcn_parsed",
    epoch: "mcn_epoch",
    done: "mcn_done",
  },
  {
    name: "Finenumbers",
    key: "finenumbers",
    parsed: "finenumbers_parsed",
    epoch: "finenumbers_epoch",
    done: "finenumbers_done",
  },
] as const;

export function parsedProviderNames(): readonly string[] {
  return SOURCES.map((source) => source.name);
}

function sourceOf(provider: string) {
  return SOURCES.find((source) => source.name === provider) ?? null;
}

function asCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function parsedPassName(
  phase: string,
  epoch: number,
  provider: string,
): string | null {
  if (!Number.isSafeInteger(epoch) || epoch < 0) return null;
  if (phase === "free") return `mask:free:${epoch}`;
  if (phase === "purchased") return `mask:purchased:${epoch}`;
  if (phase !== "provider-free" && phase !== "provider-purchased") return null;
  if (!sourceOf(provider)) return null;
  const side = phase === "provider-free" ? "free" : "purchased";
  return `provider:${provider}:${side}:${epoch}`;
}

function freePassName(phase: string, epoch: number, provider: string): string | null {
  if (phase === "purchased") return parsedPassName("free", epoch, "");
  if (phase === "provider-purchased")
    return parsedPassName("provider-free", epoch, provider);
  return null;
}

export type ParsedAlign =
  | { kind: "keep" }
  | { kind: "rename"; pass: string }
  | { kind: "zero"; pass: string }
  | {
      kind: "replace";
      pass: string;
      table: "free_numbers" | "purchased_numbers";
      afterId: string;
    }
  | { kind: "add"; pass: string; table: "purchased_numbers"; afterId: string };

/**
 * Baseline for one side. A matching pass keeps the stored counters.
 * Moving from the free pass keeps those counters. An empty cursor writes zeros.
 * A cursor that jumps home is forced to zero by the caller.
 */
export function parsedAlignAction(input: {
  phase: string;
  epoch: number;
  provider: string;
  afterId: string;
  parsedPass: string;
  cursorPhase: string;
  cursorEpoch: number;
  cursorProvider: string;
  purchasedOnly: boolean;
  forceZero?: boolean;
}): ParsedAlign {
  const pass = parsedPassName(input.phase, input.epoch, input.provider);
  if (!pass) return { kind: "keep" };
  if (input.forceZero) return { kind: "zero", pass };
  const cursorMatches =
    input.cursorPhase === input.phase &&
    input.cursorEpoch === input.epoch &&
    input.cursorProvider === input.provider;
  if (input.parsedPass === pass && (cursorMatches || input.afterId === "")) {
    return { kind: "keep" };
  }
  const freePass = freePassName(input.phase, input.epoch, input.provider);
  if (
    !input.purchasedOnly &&
    freePass !== null &&
    input.parsedPass === freePass &&
    (input.phase === "purchased" || input.phase === "provider-purchased")
  ) {
    if (input.afterId === "") return { kind: "rename", pass };
    return { kind: "add", pass, table: "purchased_numbers", afterId: input.afterId };
  }
  if (input.afterId === "") return { kind: "zero", pass };
  const purchased = input.phase === "purchased" || input.phase === "provider-purchased";
  return {
    kind: "replace",
    pass,
    table: purchased ? "purchased_numbers" : "free_numbers",
    afterId: input.afterId,
  };
}

function providerValue(provider: string): Prisma.Sql | null {
  switch (provider) {
    case "SipOut":
      return Prisma.sql`'SipOut'`;
    case "Runexis":
      return Prisma.sql`'Runexis'`;
    case "UIS":
      return Prisma.sql`'UIS'`;
    case "Aurora Telecom":
      return Prisma.sql`'Aurora Telecom'`;
    case "MTS Exolve":
      return Prisma.sql`'MTS Exolve'`;
    case "Voximplant":
      return Prisma.sql`'Voximplant'`;
    case "MCN Telecom":
      return Prisma.sql`'MCN Telecom'`;
    case "Finenumbers":
      return Prisma.sql`'Finenumbers'`;
    default:
      return null;
  }
}

function tableSql(table: "free_numbers" | "purchased_numbers"): Prisma.Sql {
  return table === "free_numbers"
    ? Prisma.sql`free_numbers`
    : Prisma.sql`purchased_numbers`;
}

function epochGuard(phase: string, epoch: number, provider: string): Prisma.Sql | null {
  if (phase === "free" || phase === "purchased") {
    return Prisma.sql`mask_epoch = ${epoch}`;
  }
  const source = sourceOf(provider);
  if (!source) return null;
  return Prisma.sql`${Prisma.raw(source.epoch)} = ${epoch}`;
}

function countCte(
  table: "free_numbers" | "purchased_numbers",
  afterId: string,
  provider: string,
): Prisma.Sql | null {
  const relation = tableSql(table);
  if (provider === "") {
    return Prisma.sql`
      WITH counts AS (
        SELECT provider, count(*)::int AS n
        FROM ${relation}
        WHERE id <= ${afterId}
        GROUP BY provider
      )
    `;
  }
  const literal = providerValue(provider);
  if (!literal) return null;
  return Prisma.sql`
    WITH counts AS (
      SELECT count(*)::int AS n
      FROM ${relation}
      WHERE provider = ${literal} AND id <= ${afterId}
    )
  `;
}

function assigned(provider: string, add: boolean): Prisma.Sql[] | null {
  if (provider === "") {
    const columns: Prisma.Sql[] = [];
    for (const source of SOURCES) {
      const literal = providerValue(source.name);
      if (!literal) return null;
      const column = Prisma.raw(source.parsed);
      const value = Prisma.sql`COALESCE((SELECT n FROM counts WHERE provider = ${literal}), 0)`;
      columns.push(
        add
          ? Prisma.sql`${column} = ${column} + ${value}`
          : Prisma.sql`${column} = ${value}`,
      );
    }
    return columns;
  }
  const source = sourceOf(provider);
  const literal = providerValue(provider);
  if (!source || !literal) return null;
  const column = Prisma.raw(source.parsed);
  const value = Prisma.sql`COALESCE((SELECT n FROM counts), 0)`;
  return [
    add ? Prisma.sql`${column} = ${column} + ${value}` : Prisma.sql`${column} = ${value}`,
  ];
}

/** One short update. It does not take a numbering-source lease. */
export function parsedAlignSql(
  action: Exclude<ParsedAlign, { kind: "keep" }>,
  input: { phase: string; epoch: number; provider: string; seenPass: string },
): Prisma.Sql | null {
  const guard = epochGuard(input.phase, input.epoch, input.provider);
  if (!guard) return null;
  const where = Prisma.sql`WHERE id = 1 AND ${guard} AND parsed_pass = ${input.seenPass}`;
  if (action.kind === "rename") {
    return Prisma.sql`
      UPDATE numbering_catalog_state
      SET parsed_pass = ${action.pass}
      ${where}
    `;
  }
  if (action.kind === "zero") {
    const one = input.provider === "" ? null : sourceOf(input.provider);
    if (input.provider !== "" && !one) return null;
    const columns = one
      ? [Prisma.sql`${Prisma.raw(one.parsed)} = 0`]
      : SOURCES.map((item) => Prisma.sql`${Prisma.raw(item.parsed)} = 0`);
    return Prisma.sql`
      UPDATE numbering_catalog_state
      SET ${Prisma.join(columns, ", ")}, parsed_pass = ${action.pass}
      ${where}
    `;
  }
  const cte = countCte(action.table, action.afterId, input.provider);
  const columns = assigned(input.provider, action.kind === "add");
  if (!cte || !columns) return null;
  return Prisma.sql`
    ${cte}
    UPDATE numbering_catalog_state
    SET ${Prisma.join(columns, ", ")}, parsed_pass = ${action.pass}
    ${where}
  `;
}

export type ParsedViewInput = {
  resplitEpoch: number;
  resplitDone: number;
  maskEpoch: number;
  maskDone: number;
  providers: readonly { name: string; epoch: number; done: number }[];
  cursorPhase: string;
  cursorAfter: string;
  cursorEpoch: number;
  cursorProvider: string;
  parsedPass: string;
};

export type ParsedView =
  | { kind: "stored" }
  | { kind: "zero" }
  | {
      kind: "count";
      table: "free_numbers" | "purchased_numbers";
      after: string;
      provider: string | null;
    };

function otherPhase(phase: string): string | null {
  if (phase === "free") return "purchased";
  if (phase === "purchased") return "free";
  if (phase === "provider-free") return "provider-purchased";
  if (phase === "provider-purchased") return "provider-free";
  return null;
}

/**
 * Stored counters are shown once the pass name includes the side.
 * The old name is counted from the cursor. A tariff pass shows zero.
 */
export function parsedView(input: ParsedViewInput): ParsedView {
  if (input.resplitEpoch > input.resplitDone) return { kind: "zero" };
  const maskOpen = input.maskEpoch > input.maskDone;
  const open = maskOpen
    ? null
    : (input.providers.find((row) => row.epoch > row.done) ?? null);
  const epoch = maskOpen ? input.maskEpoch : open?.epoch;
  const provider = maskOpen ? "" : (open?.name ?? null);
  const phases = maskOpen
    ? ["free", "purchased"]
    : ["provider-free", "provider-purchased"];
  if (epoch == null || provider == null) return { kind: "stored" };
  const owned =
    phases.includes(input.cursorPhase) &&
    input.cursorEpoch === epoch &&
    input.cursorProvider === provider;
  if (!owned) return { kind: "stored" };
  const expected = parsedPassName(
    input.cursorPhase,
    input.cursorEpoch,
    input.cursorProvider,
  );
  if (!expected || input.parsedPass === expected) return { kind: "stored" };
  const paired = otherPhase(input.cursorPhase);
  const other = paired ? parsedPassName(paired, epoch, provider) : null;
  if (other && input.parsedPass === other) return { kind: "stored" };
  if (input.cursorAfter === "") return { kind: "zero" };
  const purchased =
    input.cursorPhase === "purchased" || input.cursorPhase === "provider-purchased";
  return {
    kind: "count",
    table: purchased ? "purchased_numbers" : "free_numbers",
    after: input.cursorAfter,
    provider: provider === "" ? null : provider,
  };
}

function snapshotCopy(snapshot: ParsedSnapshot): ParsedSnapshot {
  const providers = {} as ParsedSnapshot["providers"];
  for (const source of SOURCES) {
    providers[source.key] = { ...snapshot.providers[source.key] };
  }
  return { maskEpoch: snapshot.maskEpoch, maskDone: snapshot.maskDone, providers };
}

async function readCounts(
  table: "free_numbers" | "purchased_numbers",
  after: string,
  provider: string | null,
): Promise<Partial<Record<ProviderKey, number>>> {
  const relation = tableSql(table);
  if (provider == null) {
    const rows = await prisma.$queryRaw<{ provider: string; n: number }[]>`
      SELECT provider, count(*)::int AS n
      FROM ${relation}
      WHERE id <= ${after}
      GROUP BY provider
    `;
    const counts: Partial<Record<ProviderKey, number>> = {};
    for (const row of rows) {
      const source = sourceOf(row.provider);
      if (source) counts[source.key] = asCount(row.n);
    }
    return counts;
  }
  const literal = providerValue(provider);
  const source = sourceOf(provider);
  if (!literal || !source) return {};
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM ${relation}
    WHERE provider = ${literal} AND id <= ${after}
  `;
  return { [source.key]: asCount(rows[0]?.n) };
}

/** Replaces the open counters when the stored pass name has no side. */
export async function applyParsedView(
  snapshot: ParsedSnapshot,
  input: {
    resplitEpoch: number;
    resplitDone: number;
    cursorPhase: string;
    cursorAfter: string;
    cursorEpoch: number;
    cursorProvider: string;
    parsedPass: string;
  },
): Promise<ParsedSnapshot> {
  const view = parsedView({
    ...input,
    maskEpoch: snapshot.maskEpoch,
    maskDone: snapshot.maskDone,
    providers: SOURCES.map((source) => ({
      name: source.name,
      epoch: snapshot.providers[source.key].epoch,
      done: snapshot.providers[source.key].done,
    })),
  });
  if (view.kind === "stored") return snapshot;
  const next = snapshotCopy(snapshot);
  if (view.kind === "zero") {
    for (const source of SOURCES) next.providers[source.key].parsed = 0;
    return next;
  }
  const counts = await readCounts(view.table, view.after, view.provider);
  if (view.provider == null) {
    for (const source of SOURCES) {
      next.providers[source.key].parsed = counts[source.key] ?? 0;
    }
    return next;
  }
  const source = sourceOf(view.provider);
  if (!source) return next;
  next.providers[source.key].parsed = counts[source.key] ?? 0;
  return next;
}
