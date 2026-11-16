import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { cancelExolveSync, getExolveSyncView } from "@/modules/exolve/service";

/** POST /api/numbering-sync/exolve/cancel — stop a walk before it publishes. Session only. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await cancelExolveSync();
  const settings = await getExolveSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
