import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getRunexisSyncView, startRunexisPurchased } from "@/modules/runexis/service";

/** POST /api/numbering-sync/runexis/purchased — purchased Runexis numbers. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startRunexisPurchased({ userId: actor.userId, ip: actor.ip });
  const settings = await getRunexisSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
