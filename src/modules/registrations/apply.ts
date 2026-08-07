/**
 * Apply parsed registration rows to reg_current + reg_change_events.
 *
 * Full-replace rules (successful poll only — caller must NOT invoke on
 * failed / empty stdout / exit≠0 polls):
 * - upsert every phone from the dump (insert / update / lastSeenAt)
 * - delete from reg_current any phone absent from the dump
 * - empty dump → empty reg_current
 * - reg_change_events history is retained (no event on pure delete)
 */

import type { Prisma, RegStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ParsedRegistrationRow } from "@/modules/registrations/parser";

const APPLY_TX = { maxWait: 10_000, timeout: 180_000 } as const;

export type RegistrationStateSnapshot = {
  phone: string;
  status: RegStatus;
  ip: string | null;
  port: number | null;
};

export type PlannedRegistrationChange = {
  phone: string;
  kind: "insert" | "update" | "unchanged";
  previous: RegistrationStateSnapshot | null;
  next: ParsedRegistrationRow;
  changed: boolean;
};

export type ApplyRegistrationsResult = {
  upserted: number;
  unchanged: number;
  changesCount: number;
  eventsWritten: number;
  removed: number;
};

/**
 * Pure change detection — comparable fields are status, ip, port only.
 */
export function registrationFieldsChanged(
  previous: Pick<RegistrationStateSnapshot, "status" | "ip" | "port"> | null,
  next: Pick<ParsedRegistrationRow, "status" | "ip" | "port">,
): boolean {
  if (!previous) return true;
  return (
    previous.status !== next.status ||
    previous.ip !== next.ip ||
    previous.port !== next.port
  );
}

/**
 * Plan upserts/events for a poll payload given the previous current-state map.
 */
export function planRegistrationUpdates(
  previousByPhone: Map<string, RegistrationStateSnapshot>,
  rows: ParsedRegistrationRow[],
): PlannedRegistrationChange[] {
  return rows.map((next) => {
    const previous = previousByPhone.get(next.phone) ?? null;
    const changed = registrationFieldsChanged(previous, next);
    const kind: PlannedRegistrationChange["kind"] = !previous
      ? "insert"
      : changed
        ? "update"
        : "unchanged";
    return { phone: next.phone, kind, previous, next, changed };
  });
}

type TxClient = Prisma.TransactionClient;

/**
 * Apply planned upserts/events inside an existing transaction (or prisma client).
 */
export async function applyPlannedRegistrationUpdates(
  db: TxClient,
  plans: PlannedRegistrationChange[],
  jobRunId: string,
  seenAt: Date,
): Promise<Omit<ApplyRegistrationsResult, "removed">> {
  let upserted = 0;
  let unchanged = 0;
  let changesCount = 0;
  let eventsWritten = 0;

  for (const plan of plans) {
    const { next, previous, changed } = plan;
    const status = next.status as RegStatus;

    if (!changed && previous) {
      await db.registrationCurrent.update({
        where: { phone: next.phone },
        data: {
          lastSeenAt: seenAt,
          lastJobRunId: jobRunId,
        },
      });
      unchanged += 1;
      continue;
    }

    await db.registrationCurrent.upsert({
      where: { phone: next.phone },
      create: {
        phone: next.phone,
        status,
        ip: next.ip,
        port: next.port,
        lastSeenAt: seenAt,
        lastChangedAt: seenAt,
        lastJobRunId: jobRunId,
      },
      update: {
        status,
        ip: next.ip,
        port: next.port,
        lastSeenAt: seenAt,
        lastChangedAt: seenAt,
        lastJobRunId: jobRunId,
      },
    });

    await db.registrationEvent.create({
      data: {
        phone: next.phone,
        oldStatus: previous?.status ?? null,
        newStatus: status,
        oldIp: previous?.ip ?? null,
        newIp: next.ip,
        oldPort: previous?.port ?? null,
        newPort: next.port,
        changedAt: seenAt,
        jobRunId,
      },
    });

    upserted += 1;
    changesCount += 1;
    eventsWritten += 1;
  }

  return { upserted, unchanged, changesCount, eventsWritten };
}

/**
 * Full-replace reg_current from the poll dump inside one transaction.
 */
export async function applyRegistrationPoll(
  rows: ParsedRegistrationRow[],
  jobRunId: string,
  seenAt: Date = new Date(),
): Promise<ApplyRegistrationsResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.registrationCurrent.findMany({
      select: { phone: true, status: true, ip: true, port: true },
    });

    const previousByPhone = new Map<string, RegistrationStateSnapshot>(
      existing.map((row) => [
        row.phone,
        {
          phone: row.phone,
          status: row.status,
          ip: row.ip,
          port: row.port,
        },
      ]),
    );

    const plans = planRegistrationUpdates(previousByPhone, rows);
    const applied = await applyPlannedRegistrationUpdates(
      tx,
      plans,
      jobRunId,
      seenAt,
    );

    const keep = new Set(rows.map((r) => r.phone));
    const toRemove = existing
      .map((row) => row.phone)
      .filter((phone) => !keep.has(phone));

    if (toRemove.length > 0) {
      await tx.registrationCurrent.deleteMany({
        where: { phone: { in: toRemove } },
      });
    }

    return { ...applied, removed: toRemove.length };
  }, APPLY_TX);
}
