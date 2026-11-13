import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { cancelSipoutSync, getNumberingSyncView } from "@/modules/numbering-sync/service";

/** POST /api/numbering-sync/cancel — stop a walk before it publishes. Session only. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await cancelSipoutSync();
  const settings = await getNumberingSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
