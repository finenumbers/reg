/**
 * Local db.vacuum — VACUUM FULL of the two CDR relations.
 * Live rows are copied. There is no DELETE and no TRUNCATE.
 */

import pg from "pg";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";
import { vacuumDoneMeta, vacuumStageMeta } from "@/modules/storage/vacuum/progress";
import {
  DATABASE_VACUUM_SQL,
  VACUUM_LOCK_TIMEOUT_SQL,
  VACUUM_STATEMENT_TIMEOUT_SQL,
  VACUUM_TABLE_LABEL,
  VACUUM_TABLE_ORDER,
  type VacuumTableId,
} from "@/modules/storage/vacuum/sql";

export type VacuumSqlClient = {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
};

export async function connectVacuumClient(): Promise<VacuumSqlClient> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

export type DatabaseVacuumInput = {
  trigger: "schedule" | "manual" | "test";
  actorUserId?: string;
};

export type DatabaseVacuumResult = {
  status: "success" | "failed";
  jobRunId: string;
  errorMessage?: string;
};

function errorText(error: unknown, table: VacuumTableId | null): string {
  const message = error instanceof Error ? error.message : String(error);
  const label = table ? VACUUM_TABLE_LABEL[table] : null;
  if (/lock timeout/i.test(message)) {
    const where = label ? `Таблица «${label}»` : "Таблица";
    return `${where} занята другим запросом. Сжатие остановлено, уже подтверждённые строки на месте.`;
  }
  return label ? `${label}: ${message}` : message;
}

export async function processDatabaseVacuum(
  input: DatabaseVacuumInput,
  connect: () => Promise<VacuumSqlClient> = connectVacuumClient,
): Promise<DatabaseVacuumResult> {
  const startedAt = new Date();
  const first = VACUUM_TABLE_ORDER[0];
  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "db.vacuum",
      trigger: input.trigger,
      status: "running",
      startedAt,
      actorUserId: input.actorUserId ?? null,
      meta: vacuumStageMeta(first),
    },
  });

  let client: VacuumSqlClient | null = null;
  let current: VacuumTableId = first;

  try {
    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.DB_VACUUM_START,
      entityType: "database",
      entityId: "cdr",
      meta: { jobRunId: jobRun.id },
    });

    client = await connect();
    await client.query(VACUUM_STATEMENT_TIMEOUT_SQL);
    await client.query(VACUUM_LOCK_TIMEOUT_SQL);

    for (const id of VACUUM_TABLE_ORDER) {
      current = id;
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: { meta: vacuumStageMeta(id) },
      });
      await client.query(DATABASE_VACUUM_SQL[id]);
    }

    await finish(jobRun.id, startedAt, input, {
      status: "success",
      errorMessage: null,
      meta: vacuumDoneMeta(),
    });
    return { status: "success", jobRunId: jobRun.id };
  } catch (error) {
    const errorMessage = errorText(error, current);
    logger.warn("db.vacuum.failed", { jobRunId: jobRun.id, error: errorMessage });
    await finish(jobRun.id, startedAt, input, {
      status: "failed",
      errorMessage,
      meta: vacuumStageMeta(current, current),
    });
    return { status: "failed", jobRunId: jobRun.id, errorMessage };
  } finally {
    await client?.end().catch((error: unknown) => {
      logger.warn("db.vacuum.client_end_failed", {
        jobRunId: jobRun.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    await failJobRunIfStillRunning(
      jobRun.id,
      startedAt,
      "interrupted: process restarted",
    );
  }
}

async function finish(
  jobRunId: string,
  startedAt: Date,
  input: DatabaseVacuumInput,
  result: {
    status: "success" | "failed";
    errorMessage: string | null;
    meta: ReturnType<typeof vacuumStageMeta>;
  },
): Promise<void> {
  const finishedAt = new Date();
  await prisma.jobRun.update({
    where: { id: jobRunId },
    data: {
      status: result.status,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      errorMessage:
        result.errorMessage ??
        (result.status === "success"
          ? "Таблицы звонков сжаты. Живые строки сохранены."
          : null),
      meta: result.meta,
    },
  });
  await auditService.append({
    actorUserId: input.actorUserId,
    action: AUDIT_ACTIONS.DB_VACUUM_FINISH,
    entityType: "database",
    entityId: "cdr",
    meta: {
      jobRunId,
      status: result.status,
      error: result.errorMessage,
    },
  });
  logger.info("db.vacuum.finished", {
    jobRunId,
    status: result.status,
  });
}
