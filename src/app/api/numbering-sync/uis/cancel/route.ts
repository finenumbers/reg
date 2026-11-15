import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { cancelUisSync, getUisSyncView } from "@/modules/uis/service";

/** POST /api/numbering-sync/uis/cancel — stop a walk before it publishes. Session only. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await cancelUisSync();
  const settings = await getUisSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
