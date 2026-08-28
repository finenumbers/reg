import { logger } from "@/lib/logger";

export function requestVoipmonitorMatch(
  trigger: "schedule" | "manual" = "schedule",
): void {
  void import("@/modules/jobs/runtime")
    .then(({ jobRuntime }) =>
      jobRuntime.enqueue({ actionCode: "voipmonitor.match", trigger }),
    )
    .catch((error) => {
      logger.warn("voipmonitor.match.enqueue_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
