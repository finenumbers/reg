/**
 * cdr.sides.refresh — apply catalog Описание diffs onto stored CDR sides.
 */

import type { Prisma } from "@/generated/prisma/client";
import { chunkArray, DB_IN_CHUNK } from "@/lib/chunk";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";
import { buildPhoneDescriptionMap } from "@/modules/registrations/phone-description";
import { listInboxFiles } from "@/modules/traffic/inbox";
import {
  descriptionMapsEqual,
  diffDescriptionMaps,
  parseDescriptionMap,
  serializeDescriptionMap,
} from "@/modules/traffic/sides-refresh/diff";
import { buildSidesUpdateSql } from "@/modules/traffic/sides-refresh/sql";

export type CdrSidesRefreshInput = {
  trigger: "schedule" | "manual" | "test";
  actorUserId?: string;
};

export type CdrSidesRefreshResult = {
  status: "success" | "failed";
  jobRunId: string;
  phonesParsed: number;
  changesCount: number;
  skipped?: boolean;
  replay?: boolean;
  errorMessage?: string;
};

async function currentJobsBusy(): Promise<boolean> {
  const { jobRuntime } = await import("@/modules/jobs/runtime");
  return (
    jobRuntime.isInFlight("phones.sync") || jobRuntime.isInFlight("cdr.import")
  );
}

export async function loadPhoneDescriptionMap(): Promise<Map<string, string>> {
  const rows = await prisma.phoneEndpoint.findMany({
    where: { endpointNumber: { not: null } },
    select: { endpointNumber: true, name: true, data: true },
    orderBy: { name: "asc" },
  });
  return buildPhoneDescriptionMap(rows);
}

async function catalogSyncedAt(): Promise<Date | null> {
  const state = await prisma.phoneImportState.findUnique({
    where: { id: 1 },
    select: { lastSyncedAt: true },
  });
  return state?.lastSyncedAt ?? null;
}

export async function processCdrSidesRefresh(
  input: CdrSidesRefreshInput,
): Promise<CdrSidesRefreshResult> {
  if (await currentJobsBusy()) {
    logger.info("cdr.sides.refresh.skipped", { reason: "sync_or_import_inflight" });
    return {
      status: "success",
      jobRunId: "",
      phonesParsed: 0,
      changesCount: 0,
      skipped: true,
    };
  }

  const pendingInbox = await listInboxFiles();
  if (pendingInbox.length > 0) {
    logger.info("cdr.sides.refresh.skipped", { reason: "inbox_dirty" });
    return {
      status: "success",
      jobRunId: "",
      phonesParsed: 0,
      changesCount: 0,
      skipped: true,
    };
  }

  const startedAt = new Date();
  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "cdr.sides.refresh",
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
          ? AUDIT_ACTIONS.CDR_SIDES_REFRESH_MANUAL
          : AUDIT_ACTIONS.CDR_SIDES_REFRESH_START,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: { trigger: input.trigger, phase: "started" },
    });

    const current = await loadPhoneDescriptionMap();
    if (current.size === 0) {
      const finishedAt = new Date();
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status: "failed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: "Пустой справочник описаний — журнал звонков не изменён",
          phonesParsed: 0,
          changesCount: 0,
        },
      });
      await auditService.append({
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.CDR_SIDES_REFRESH_FINISH,
        entityType: "job_run",
        entityId: jobRun.id,
        meta: { trigger: input.trigger, status: "failed", reason: "empty_map" },
      });
      return {
        status: "failed",
        jobRunId: jobRun.id,
        phonesParsed: 0,
        changesCount: 0,
        errorMessage: "Пустой справочник описаний — журнал звонков не изменён",
      };
    }

    const catalogAtStart = await catalogSyncedAt();
    const settings = await prisma.appSetting.findUnique({
      where: { id: 1 },
      select: {
        cdrSidesRefreshMap: true,
        cdrSidesRefreshCatalogAt: true,
      },
    });
    const previous = parseDescriptionMap(settings?.cdrSidesRefreshMap);
    const pairs = diffDescriptionMaps(previous, current);

    let changesCount = 0;
    if (pairs.length > 0) {
      for (const chunk of chunkArray(pairs, DB_IN_CHUNK)) {
        const updatedA = await prisma.$executeRaw(buildSidesUpdateSql("a", chunk));
        const updatedB = await prisma.$executeRaw(buildSidesUpdateSql("b", chunk));
        changesCount += Number(updatedA) + Number(updatedB);
      }
    }

    const catalogAtEnd = await catalogSyncedAt();
    const catalogMoved =
      (catalogAtStart?.getTime() ?? null) !== (catalogAtEnd?.getTime() ?? null);

    if (!catalogMoved) {
      const sameAsPrevious =
        previous != null && descriptionMapsEqual(previous, current);
      if (!sameAsPrevious) {
        await prisma.appSetting.update({
          where: { id: 1 },
          data: {
            cdrSidesRefreshMap:
              serializeDescriptionMap(current) as Prisma.InputJsonValue,
            cdrSidesRefreshCatalogAt: catalogAtEnd,
          },
        });
      }
    }

    const finishedAt = new Date();
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "success",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage: null,
        phonesParsed: pairs.length,
        changesCount,
        meta: {
          diffPhones: pairs.length,
          rowsTouched: changesCount,
          replay: catalogMoved,
          catalogAt: catalogAtEnd?.toISOString() ?? null,
        },
      },
    });

    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.CDR_SIDES_REFRESH_FINISH,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: {
        trigger: input.trigger,
        status: "success",
        phonesParsed: pairs.length,
        changesCount,
        replay: catalogMoved,
      },
    });

    logger.info("cdr.sides.refresh.finished", {
      jobRunId: jobRun.id,
      phonesParsed: pairs.length,
      changesCount,
      replay: catalogMoved,
    });

    return {
      status: "success",
      jobRunId: jobRun.id,
      phonesParsed: pairs.length,
      changesCount,
      replay: catalogMoved,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const finishedAt = new Date();
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "failed",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage,
      },
    });
    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.CDR_SIDES_REFRESH_FINISH,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: { trigger: input.trigger, status: "failed", error: errorMessage },
    });
    logger.warn("cdr.sides.refresh.failed", {
      jobRunId: jobRun.id,
      error: errorMessage,
    });
    return {
      status: "failed",
      jobRunId: jobRun.id,
      phonesParsed: 0,
      changesCount: 0,
      errorMessage,
    };
  } finally {
    await failJobRunIfStillRunning(
      jobRun.id,
      startedAt,
      "Job ended without a terminal status",
    );
  }
}
