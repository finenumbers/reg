import { logger } from "@/lib/logger";

export function requestCdrSidesRefresh(
  trigger: "schedule" | "manual" = "schedule",
): void {
  void import("@/modules/jobs/runtime")
    .then(({ jobRuntime }) =>
      jobRuntime.enqueue({ actionCode: "cdr.sides.refresh", trigger }),
    )
    .catch((error) => {
      logger.warn("cdr.sides.refresh.enqueue_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
