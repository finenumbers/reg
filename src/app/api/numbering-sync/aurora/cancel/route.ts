import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { cancelAuroraSync, getAuroraSyncView } from "@/modules/aurora/service";

export const runtime = "nodejs";

/** POST /api/numbering-sync/aurora/cancel — stop a walk before it publishes. Session only. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await cancelAuroraSync();
  const settings = await getAuroraSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
