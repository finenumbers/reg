/**
 * Registrations operational status for dashboard / banners.
 * Local DB only — never live SSH.
 */

import { prisma } from "@/lib/db";
import { getJobRunSummary } from "@/modules/jobs/query";
import type { RegsPollStatus } from "@/modules/registrations/types";

export type RegistrationsOperationalStatus = RegsPollStatus & {
  totalCount: number;
  registeredCount: number;
  unregisteredCount: number;
  lastSuccessAt: string | null;
  lastFailedAt: string | null;
  lastFailedError: string | null;
  runningCount: number;
};

/** Live SIP Unregistered rows in reg_current. Local DB only. */
export async function countUnregisteredCurrent(): Promise<number> {
  return prisma.registrationCurrent.count({ where: { status: "Unregistered" } });
}

export async function getRegistrationsOperationalStatus(): Promise<RegistrationsOperationalStatus> {
  const [settings, summary, totalCount, registeredCount, unregisteredCount] =
    await Promise.all([
      prisma.appSetting.findUnique({ where: { id: 1 } }),
      getJobRunSummary("regs.poll"),
      prisma.registrationCurrent.count(),
      prisma.registrationCurrent.count({ where: { status: "Registered" } }),
      countUnregisteredCurrent(),
    ]);

  const lastAny = summary.lastAny;
  let lastJobStatus: RegsPollStatus["lastJobStatus"] = "never";
  if (lastAny) {
    lastJobStatus = lastAny.status;
  }

  return {
    lastJobStatus,
    lastError:
      lastAny?.status === "failed"
        ? (lastAny.errorMessage ?? "Poll failed")
        : lastAny?.status === "success"
          ? null
          : (summary.lastFailed?.errorMessage ?? null),
    lastFinishedAt: lastAny?.finishedAt ?? lastAny?.startedAt ?? null,
    pollEnabled: settings?.regsPollEnabled ?? false,
    totalCount,
    registeredCount,
    unregisteredCount,
    lastSuccessAt: summary.lastSuccess?.finishedAt ?? summary.lastSuccess?.startedAt ?? null,
    lastFailedAt: summary.lastFailed?.finishedAt ?? summary.lastFailed?.startedAt ?? null,
    lastFailedError: summary.lastFailed?.errorMessage ?? null,
    runningCount: summary.runningCount,
  };
}
