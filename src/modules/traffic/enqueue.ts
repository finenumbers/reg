import { markCdrInboxDirty } from "@/modules/traffic/drain-flag";

/** Enqueue inbox drain — never throws. Marks dirty so an in-flight run will loop. */
export function requestCdrImportDrain(trigger: "schedule" | "manual"): void {
  markCdrInboxDirty();
  void import("@/modules/jobs/runtime").then(({ jobRuntime }) =>
    jobRuntime.enqueue({ actionCode: "cdr.import", trigger }),
  );
}
