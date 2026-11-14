import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { cancelRunexisSync, getRunexisSyncView } from "@/modules/runexis/service";

/** POST /api/numbering-sync/runexis/cancel — stop a walk before it publishes. Session only. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await cancelRunexisSync();
  const settings = await getRunexisSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
