/**
 * phones.sync — read the RTU page «Оборудование» and replace the phone catalog.
 * Does not call SSH. A failed or incomplete read does not touch the tables.
 */

import type { JobTrigger } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { applyPhonesSnapshot } from "@/modules/phones/apply";
import { readStoredEquipment, type EquipmentRead } from "@/modules/phones/rtu-read";
import {
  refusePhonesSnapshot,
  type EquipmentIdentity,
  type PhoneCatalogSide,
} from "@/modules/phones/rtu-rows";
import type { PhoneRowData } from "@/modules/phones/types";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";
import { requestRtuScreenPublish } from "@/modules/rtu/screen-publish";

export type PhonesSyncProcessorInput = {
  trigger: JobTrigger;
  actorUserId?: string | null;
};

export type PhonesSyncProcessorResult = {
  jobRunId: string;
  status: "success" | "failed";
  errorMessage: string | null;
  phonesParsed: number;
  endpointCount: number;
  gatewayCount: number;
  exitCode: number | null;
  /** In-memory rows from the read. Not stored on the job. */
  identities: EquipmentIdentity[] | null;
  /** The catalog was saved, and the screen snapshot is still catching up. */
  screenPending?: boolean;
};

export type PhonesSyncProcessorDeps = {
  read: () => Promise<EquipmentRead>;
  apply: typeof applyPhonesSnapshot;
  catalog: () => Promise<PhoneCatalogSide>;
  publishScreen?: () => Promise<{ published: boolean }>;
};

async function loadPhoneCatalog(): Promise<PhoneCatalogSide> {
  const [endpoints, gateways] = await Promise.all([
    prisma.phoneEndpoint.findMany({ select: { data: true } }),
    prisma.phoneGateway.findMany({ select: { data: true } }),
  ]);
  return {
    endpoints: endpoints.map((row) => asRow(row.data)),
    gateways: gateways.map((row) => asRow(row.data)),
  };
}

function asRow(data: unknown): PhoneRowData {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out: PhoneRowData = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean")
      out[key] = String(value);
  }
  return out;
}

const DEFAULT_DEPS: PhonesSyncProcessorDeps = {
  read: () => readStoredEquipment(),
  apply: applyPhonesSnapshot,
  catalog: loadPhoneCatalog,
};

export async function processPhonesSync(
  input: PhonesSyncProcessorInput,
  deps: PhonesSyncProcessorDeps = DEFAULT_DEPS,
): Promise<PhonesSyncProcessorResult> {
  const startedAt = new Date();

  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "phones.sync",
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
          ? AUDIT_ACTIONS.PHONES_SYNC_MANUAL
          : AUDIT_ACTIONS.PHONES_SYNC_START,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: {
        trigger: input.trigger,
        actionCode: "phones.sync",
        phase: "started",
      },
    });

    logger.info("phones.sync.started", {
      jobRunId: jobRun.id,
      trigger: input.trigger,
    });

    let snapshotIdentities: EquipmentIdentity[] | null = null;

    const fail = async (errorMessage: string): Promise<PhonesSyncProcessorResult> => {
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
        action: AUDIT_ACTIONS.PHONES_SYNC_FINISH,
        entityType: "job_run",
        entityId: jobRun.id,
        meta: {
          trigger: input.trigger,
          status: "failed",
          errorMessage,
        },
      });

      logger.warn("phones.sync.failed", {
        jobRunId: jobRun.id,
        errorMessage,
      });

      return {
        jobRunId: jobRun.id,
        status: "failed",
        errorMessage,
        phonesParsed: 0,
        endpointCount: 0,
        gatewayCount: 0,
        exitCode: null,
        identities: snapshotIdentities,
      };
    };

    const read = await deps.read();
    if (!read.ok) return fail(read.detail);
    snapshotIdentities = read.identities ?? null;
    const payload = read.payload;
    const totalRows = payload.endpoints.length + payload.gateways.length;

    let catalog: PhoneCatalogSide;
    try {
      catalog = await deps.catalog();
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Failed to read the phone catalog",
      );
    }
    if (totalRows === 0 && catalog.endpoints.length + catalog.gateways.length > 0) {
      return fail("Пустой снимок отклонён — отказ от wipe непустой таблицы номеров");
    }
    const refused = refusePhonesSnapshot(catalog, payload);
    if (!refused.ok) return fail(refused.detail);

    let applyResult;
    try {
      applyResult = await deps.apply(payload, jobRun.id, new Date());
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Failed to apply phones snapshot",
      );
    }

    const finishedAt = new Date();
    try {
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status: "success",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: null,
          exitCode: null,
          phonesParsed: totalRows,
          linesBad: 0,
          changesCount: totalRows,
          meta: {
            endpointCount: applyResult.endpointCount,
            gatewayCount: applyResult.gatewayCount,
            version: payload.version,
            source: "rtu",
          },
        },
      });

      await auditService.append({
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.PHONES_SYNC_FINISH,
        entityType: "job_run",
        entityId: jobRun.id,
        meta: {
          trigger: input.trigger,
          status: "success",
          endpointCount: applyResult.endpointCount,
          gatewayCount: applyResult.gatewayCount,
          phonesParsed: totalRows,
        },
      });
    } catch (error) {
      logger.warn("phones.sync.post_apply_finalize_failed", {
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
            phonesParsed: totalRows,
            linesBad: 0,
            changesCount: totalRows,
          },
        });
      } catch (markError) {
        logger.error("phones.sync.success_mark_failed", {
          jobRunId: jobRun.id,
          error: markError instanceof Error ? markError.message : String(markError),
        });
      }
    }

    logger.info("phones.sync.finished", {
      jobRunId: jobRun.id,
      endpointCount: applyResult.endpointCount,
      gatewayCount: applyResult.gatewayCount,
    });

    let screenPending = false;
    try {
      const published = await (deps.publishScreen ?? requestRtuScreenPublish)();
      screenPending = published.published !== true;
    } catch (error) {
      screenPending = true;
      logger.warn("phones.sync.screen_pending", {
        jobRunId: jobRun.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      jobRunId: jobRun.id,
      status: "success",
      errorMessage: null,
      phonesParsed: totalRows,
      endpointCount: applyResult.endpointCount,
      gatewayCount: applyResult.gatewayCount,
      exitCode: null,
      identities: snapshotIdentities,
      screenPending,
    };
  } finally {
    await failJobRunIfStillRunning(
      jobRun.id,
      startedAt,
      "Job ended without a terminal status",
    );
  }
}
