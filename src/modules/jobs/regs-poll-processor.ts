/**
 * regs.poll — read the RTU registration pages and replace reg_current.
 * Does not call SSH and does not store a SOAP body.
 */

import type { JobTrigger } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { enqueueStaleGeoLookups, uniqueLookupIps } from "@/modules/geoip";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";
import {
  applyRegistrationPoll,
  type ApplyRegistrationsResult,
} from "@/modules/registrations/apply";
import {
  readStoredRegistrations,
  type RegistrationsRead,
} from "@/modules/registrations/rtu-read";
import {
  assembleRegistrations,
  REGISTRATION_FLAG_FIELD,
  REGISTRATION_NAME_FIELD,
  type CatalogRegistrationEndpoint,
} from "@/modules/registrations/rtu-rows";

/**
 * Sanitize stderr for inclusion in a job error. Phones sync still uses this.
 * Strips ANSI and control characters and prefers a permission line.
 */
export function sanitizeStderrSnippet(stderr: string, maxLen = 240): string {
  const strip = (value: string) =>
    value
      .replace(/\u001b\[[0-9;]*m/g, "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .trim();
  const lines = stderr
    .split(/\r?\n/)
    .map(strip)
    .filter((line) => line.length > 0);
  if (lines.length === 0) return "";
  const preferred =
    lines.find((line) => /permission denied|sudo:|mysql:|access-db\.conf/i.test(line)) ??
    lines[0]!;
  if (preferred.length <= maxLen) return preferred;
  return `${preferred.slice(0, Math.max(0, maxLen - 1))}…`;
}

export type RegsPollProcessorInput = {
  trigger: JobTrigger;
  actorUserId?: string | null;
};

export type RegsPollProcessorResult = {
  jobRunId: string;
  status: "success" | "failed";
  errorMessage: string | null;
  phonesParsed: number;
  linesBad: number;
  changesCount: number;
  exitCode: number | null;
};

export type CatalogLoad =
  | { ok: true; rows: CatalogRegistrationEndpoint[] }
  | { ok: false; detail: string };

export type RegsPollProcessorDeps = {
  read: () => Promise<RegistrationsRead>;
  loadCatalog: () => Promise<CatalogLoad>;
  countCurrent: () => Promise<number>;
  apply: typeof applyRegistrationPoll;
  enqueueGeoEnrich?: (ips: string[]) => void;
};

async function loadPhoneCatalog(): Promise<CatalogLoad> {
  try {
    const rows = await prisma.phoneEndpoint.findMany({
      select: { endpointNumber: true, data: true },
    });
    return {
      ok: true,
      rows: rows.map((row) => ({
        endpointNumber: row.endpointNumber,
        registrationName: catalogCell(row.data, REGISTRATION_NAME_FIELD),
        registrationFlag: catalogCell(row.data, REGISTRATION_FLAG_FIELD),
      })),
    };
  } catch (error) {
    logger.warn("regs.poll.catalog_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, detail: "Каталог телефонных номеров не прочитан." };
  }
}

function catalogCell(data: unknown, key: string): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

const DEFAULT_DEPS: RegsPollProcessorDeps = {
  read: () => readStoredRegistrations(),
  loadCatalog: loadPhoneCatalog,
  countCurrent: () => prisma.registrationCurrent.count(),
  apply: applyRegistrationPoll,
};

export async function processRegsPoll(
  input: RegsPollProcessorInput,
  deps: RegsPollProcessorDeps = DEFAULT_DEPS,
): Promise<RegsPollProcessorResult> {
  const startedAt = new Date();
  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "regs.poll",
      trigger: input.trigger,
      status: "running",
      startedAt,
      actorUserId: input.actorUserId ?? null,
    },
  });

  try {
    await auditService.append({
      actorUserId: input.actorUserId,
      action:
        input.trigger === "manual"
          ? AUDIT_ACTIONS.REGS_POLL_MANUAL
          : AUDIT_ACTIONS.REGS_POLL_START,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: {
        trigger: input.trigger,
        actionCode: "regs.poll",
        phase: "started",
      },
    });

    logger.info("regs.poll.started", {
      jobRunId: jobRun.id,
      trigger: input.trigger,
    });

    const fail = async (errorMessage: string): Promise<RegsPollProcessorResult> => {
      const finishedAt = new Date();
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status: "failed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage,
          exitCode: null,
          phonesParsed: 0,
          linesBad: 0,
          changesCount: 0,
        },
      });
      await auditService.append({
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.REGS_POLL_FINISH,
        entityType: "job_run",
        entityId: jobRun.id,
        meta: {
          trigger: input.trigger,
          status: "failed",
          errorMessage,
        },
      });
      logger.warn("regs.poll.failed", {
        jobRunId: jobRun.id,
        errorMessage,
      });
      return {
        jobRunId: jobRun.id,
        status: "failed",
        errorMessage,
        phonesParsed: 0,
        linesBad: 0,
        changesCount: 0,
        exitCode: null,
      };
    };

    const read = await deps.read();
    if (!read.ok) return fail(read.detail);
    const catalog = await deps.loadCatalog();
    if (!catalog.ok) return fail(catalog.detail);
    const assembled = assembleRegistrations({
      pcomm: read.pcomm,
      pupr: read.pupr,
      catalog: catalog.rows,
      endMask: read.endMask,
    });
    if (!assembled.ok) return fail(assembled.detail);
    if (assembled.value.pcommCount === 0) {
      const previous = await deps.countCurrent();
      if (previous > 0) {
        return fail("Пустой снимок отклонён — отказ от wipe непустой таблицы регистраций");
      }
    }

    let applyResult: ApplyRegistrationsResult;
    try {
      applyResult = await deps.apply(assembled.value.rows, jobRun.id, new Date());
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Не удалось записать регистрации.",
      );
    }

    const finishedAt = new Date();
    const phoneCount = assembled.value.rows.length;
    try {
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status: "success",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: null,
          exitCode: null,
          phonesParsed: phoneCount,
          linesBad: 0,
          changesCount: applyResult.changesCount,
          meta: {
            source: "rtu",
            phoneCount,
            removed: applyResult.removed,
          },
        },
      });
      await auditService.append({
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.REGS_POLL_FINISH,
        entityType: "job_run",
        entityId: jobRun.id,
        meta: {
          trigger: input.trigger,
          status: "success",
          phonesParsed: phoneCount,
          changesCount: applyResult.changesCount,
        },
      });
    } catch (error) {
      logger.warn("regs.poll.post_apply_finalize_failed", {
        jobRunId: jobRun.id,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await prisma.jobRun.update({
          where: { id: jobRun.id },
          data: {
            status: "success",
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            errorMessage: null,
            exitCode: null,
            phonesParsed: phoneCount,
            linesBad: 0,
            changesCount: applyResult.changesCount,
          },
        });
      } catch (markError) {
        logger.error("regs.poll.success_mark_failed", {
          jobRunId: jobRun.id,
          error: markError instanceof Error ? markError.message : String(markError),
        });
      }
    }

    logger.info("regs.poll.finished", {
      jobRunId: jobRun.id,
      phonesParsed: phoneCount,
      changesCount: applyResult.changesCount,
    });

    try {
      (deps.enqueueGeoEnrich ?? enqueueStaleGeoLookups)(
        uniqueLookupIps(assembled.value.rows.map((row) => row.ip)),
      );
    } catch (error) {
      logger.warn("regs.poll.geoip_enqueue_failed", {
        jobRunId: jobRun.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      jobRunId: jobRun.id,
      status: "success",
      errorMessage: null,
      phonesParsed: phoneCount,
      linesBad: 0,
      changesCount: applyResult.changesCount,
      exitCode: null,
    };
  } finally {
    await failJobRunIfStillRunning(
      jobRun.id,
      startedAt,
      "Job ended without a terminal status",
    );
  }
}
