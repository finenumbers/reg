import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getRunexisSyncView } from "@/modules/runexis/service";

/** GET /api/numbering-sync/runexis — Runexis stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ settings: await getRunexisSyncView() });
}
