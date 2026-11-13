/**
 * Write marking labels only when the file's phones equal the live working set.
 * The comparison and the upsert are one statement. A mismatch writes nothing.
 * The lock is not the phone-catalog lock or the mask-catalog lock.
 */

import { isTransientPrismaError } from "@/lib/prisma-transient";
import { MARKING_PARSE_ERROR, type MarkingParsedRow } from "@/modules/marking/parse-xlsx";
import {
  MARKING_DUPLICATE_ERROR,
  MARKING_LOCK_ERROR,
  MARKING_READ_ERROR,
  MARKING_SCREEN_ERROR,
  MARKING_SET_ERROR,
  markingImportPayload,
  markingSetDetails,
} from "@/modules/marking/payload";
import { markingApplySql, markingLockSql } from "@/modules/marking/sql";
import {
  isMarkingLockTimeout,
  isMarkingStatementTimeout,
  MARKING_WRITE_TIMEOUT,
  withMarkingTimeout,
} from "@/modules/marking/timeout";
import { readRtuScreenGate, requestRtuScreenPublish } from "@/modules/rtu/screen-publish";

const APPLY_TX_MS = 40_000;

export type ApplyMarkingResult = {
  rowCount: number;
  loadedAt: Date;
};

export class MarkingRejected extends Error {
  readonly details: string[];

  constructor(message: string, details: string[]) {
    super(message);
    this.name = "MarkingRejected";
    this.details = details.length > 0 ? details : [message];
  }
}

export type MarkingApplyHttpError = {
  status: 400 | 409 | 503;
  error: string;
  details: string[];
};

export function markingApplyHttpError(error: unknown): MarkingApplyHttpError | null {
  if (error instanceof MarkingRejected) {
    return { status: 400, error: error.message, details: error.details };
  }
  if (isUniqueViolation(error)) {
    return { status: 400, error: MARKING_PARSE_ERROR, details: [MARKING_DUPLICATE_ERROR] };
  }
  if (isMarkingLockTimeout(error)) {
    return { status: 409, error: MARKING_LOCK_ERROR, details: [MARKING_LOCK_ERROR] };
  }
  if (isMarkingStatementTimeout(error)) {
    return { status: 503, error: MARKING_READ_ERROR, details: [MARKING_READ_ERROR] };
  }
  if (isTransientPrismaError(error)) {
    return { status: 409, error: BUSY, details: [BUSY] };
  }
  return null;
}

const BUSY = "Идёт загрузка маркировки. Повторите, когда она закончится.";

type ApplyQueryRow = {
  working_n: number | null;
  incoming_n: number | null;
  incoming_distinct: number | null;
  matched: number | null;
  published: boolean | null;
  written_n: number | null;
  state_n: number | null;
  missing_sample: unknown;
  unknown_sample: unknown;
};

export async function applyMarkingLabels(
  rows: MarkingParsedRow[],
  filename: string,
  loadedAt: Date = new Date(),
): Promise<ApplyMarkingResult> {
  if (rows.length === 0) {
    throw new MarkingRejected(MARKING_PARSE_ERROR, ["В файле нет строк с данными"]);
  }

  const gate = await readRtuScreenGate();
  if (!gate?.published || gate.needsPublish) {
    void requestRtuScreenPublish();
  }
  if (!gate?.published) {
    throw new MarkingRejected(MARKING_SCREEN_ERROR, [MARKING_SCREEN_ERROR]);
  }

  const payload = markingImportPayload(rows);
  const row = await withMarkingTimeout(MARKING_WRITE_TIMEOUT, APPLY_TX_MS, async (tx) => {
    await tx.$executeRaw(markingLockSql());
    const found = await tx.$queryRaw<ApplyQueryRow[]>(
      markingApplySql(payload, filename, loadedAt),
    );
    const head = found[0];
    if (!head) {
      throw new MarkingRejected(MARKING_READ_ERROR, [MARKING_READ_ERROR]);
    }
    const outcome = interpretApplyRow(head);
    if (!outcome.ok) throw new MarkingRejected(outcome.error, outcome.details);
    return outcome;
  });

  return { rowCount: row.rowCount, loadedAt };
}

function interpretApplyRow(
  row: ApplyQueryRow,
):
  | { ok: true; rowCount: number }
  | { ok: false; error: string; details: string[] } {
  const workingN = numberOf(row.working_n);
  const incomingN = numberOf(row.incoming_n);
  const incomingDistinct = numberOf(row.incoming_distinct);
  const matched = numberOf(row.matched);
  const writtenN = numberOf(row.written_n);
  const stateN = numberOf(row.state_n);
  if (row.published !== true) {
    return { ok: false, error: MARKING_SCREEN_ERROR, details: [MARKING_SCREEN_ERROR] };
  }
  if (incomingDistinct !== incomingN) {
    return {
      ok: false,
      error: MARKING_PARSE_ERROR,
      details: [MARKING_DUPLICATE_ERROR],
    };
  }
  const setsMatch = workingN === incomingN && matched === workingN && incomingN > 0;
  if (!setsMatch) {
    return {
      ok: false,
      error: MARKING_SET_ERROR,
      details: markingSetDetails({
        workingN,
        incomingN,
        incomingDistinct,
        matched,
        missing: textList(row.missing_sample),
        unknown: textList(row.unknown_sample),
      }),
    };
  }
  if (writtenN !== incomingN || stateN !== 1) {
    return { ok: false, error: MARKING_READ_ERROR, details: [MARKING_READ_ERROR] };
  }
  return { ok: true, rowCount: writtenN };
}

function numberOf(value: number | null): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function textList(value: unknown): string[] {
  const source = typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(source)) return [];
  return source.filter((item): item is string => typeof item === "string");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return [];
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
