/**
 * Liveness / readiness probes for Docker, NPM, and operators.
 * Liveness helpers stay free of Prisma imports so /api/healthz can build without DB.
 */

import { tryValidateServerEnv } from "@/lib/env";

export type LivenessResult = {
  status: "ok";
};

export type ReadinessResult =
  | {
      status: "ready";
      checks: {
        database: "ok";
        env: "ok";
      };
    }
  | {
      status: "not_ready";
      checks: {
        database: "ok" | "error" | "skipped";
        env: "ok" | "error";
      };
      /** Omitted or generic in production responses — see route handler */
      detail?: string;
    };

export function checkLiveness(): LivenessResult {
  return { status: "ok" };
}

export async function checkReadiness(): Promise<ReadinessResult> {
  const env = tryValidateServerEnv();
  if (!env.ok) {
    return {
      status: "not_ready",
      checks: { database: "skipped", env: "error" },
      detail: env.error,
    };
  }

  try {
    const { prisma } = await import("@/lib/db");
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: "ready",
      checks: { database: "ok", env: "ok" },
    };
  } catch (error) {
    return {
      status: "not_ready",
      checks: { database: "error", env: "ok" },
      detail: error instanceof Error ? error.message : "database unreachable",
    };
  }
}
