/**
 * Next.js instrumentation — preferred bootstrap entry for in-process scheduler.
 *
 * Startup order (Node runtime):
 * 1. Validate server env (fail loud on invalid / weak production secrets)
 * 2. Ensure platform baseline (RBAC, allowlist, app_settings)
 * 3. Idempotent admin bootstrap from ADMIN_* env
 * 4. Reclaim orphan running job_runs (process restart)
 * 5. Start Settings-gated scheduler loop (always-on timer; ticks respect regsPollEnabled)
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logger } = await import("@/lib/logger");

    try {
      const { assertServerEnvAtStartup } = await import("@/lib/env");
      const { warnings } = assertServerEnvAtStartup();
      for (const warning of warnings) {
        logger.warn("env.startup.warning", { warning });
      }
    } catch (error) {
      logger.error("env.startup.invalid", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Re-throw so misconfiguration fails fast in production instead of serving half-broken.
      throw error;
    }

    try {
      const { ensurePlatformBaseline } = await import(
        "@/modules/platform/ensure-baseline"
      );
      await ensurePlatformBaseline();
      logger.info("platform.baseline.ensure", { status: "ok" });
    } catch (error) {
      logger.error("platform.baseline.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const { bootstrapAdminIfEmpty } = await import("@/modules/users/bootstrap");
      const bootstrap = await bootstrapAdminIfEmpty();
      if (bootstrap.status === "skipped") {
        logger.info("admin.bootstrap.evaluate", {
          status: bootstrap.status,
          reason: bootstrap.reason,
        });
      } else {
        logger.info("admin.bootstrap.evaluate", {
          status: bootstrap.status,
          username: bootstrap.username,
        });
      }
    } catch (error) {
      logger.error("admin.bootstrap.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const { reclaimOrphanJobRuns } = await import(
        "@/modules/jobs/reclaim-orphans"
      );
      const reclaim = await reclaimOrphanJobRuns();
      logger.info("jobs.reclaim_orphans", reclaim);
    } catch (error) {
      logger.error("jobs.reclaim_orphans.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const { reclaimOrphanEnrichJobs, pruneEnrichArtifacts } = await import(
        "@/modules/enrich/reclaim"
      );
      const enrichReclaim = await reclaimOrphanEnrichJobs();
      logger.info("enrich.reclaim_orphans", enrichReclaim);
      const pruned = await pruneEnrichArtifacts();
      logger.info("enrich.artifacts_pruned", pruned);
    } catch (error) {
      logger.error("enrich.reclaim_orphans.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const { evaluateSchedulerBootstrap } = await import("@/modules/jobs/runtime");
    const result = evaluateSchedulerBootstrap();
    logger.warn("scheduler.bootstrap.evaluate", result);
  }
}
