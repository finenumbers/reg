import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { cancelMcnSync, getMcnSyncView } from "@/modules/mcn/service";

/** POST /api/numbering-sync/mcn/cancel — stop a walk before it publishes. Session only. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await cancelMcnSync();
  const settings = await getMcnSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
