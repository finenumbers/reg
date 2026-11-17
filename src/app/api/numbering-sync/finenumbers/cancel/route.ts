import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { cancelFinenumbersSync, getFinenumbersSyncView } from "@/modules/finenumbers/service";

/** POST /api/numbering-sync/finenumbers/cancel — stop a walk before it publishes. Session only. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await cancelFinenumbersSync();
  const settings = await getFinenumbersSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
