import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getNumberingSyncView } from "@/modules/numbering-sync/service";

/** GET /api/numbering-sync — stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const settings = await getNumberingSyncView();
  return numberingSyncJson({ settings });
}
