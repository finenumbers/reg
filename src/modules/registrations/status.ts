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

export async function getRegistrationsOperationalStatus(): Promise<RegistrationsOperationalStatus> {
  const [settings, summary, totalCount, registeredCount] = await Promise.all([
    prisma.appSetting.findUnique({ where: { id: 1 } }),
    getJobRunSummary("regs.poll"),
    prisma.registrationCurrent.count(),
    prisma.registrationCurrent.count({ where: { status: "Registered" } }),
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
        : summary.lastFailed?.errorMessage ?? null,
    lastFinishedAt: lastAny?.finishedAt ?? lastAny?.startedAt ?? null,
    pollEnabled: settings?.regsPollEnabled ?? false,
    totalCount,
    registeredCount,
    unregisteredCount: Math.max(0, totalCount - registeredCount),
    lastSuccessAt: summary.lastSuccess?.finishedAt ?? summary.lastSuccess?.startedAt ?? null,
    lastFailedAt: summary.lastFailed?.finishedAt ?? summary.lastFailed?.startedAt ?? null,
    lastFailedError: summary.lastFailed?.errorMessage ?? null,
    runningCount: summary.runningCount,
  };
}
