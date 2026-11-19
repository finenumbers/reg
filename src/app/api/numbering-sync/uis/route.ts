import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getUisSyncView } from "@/modules/uis/service";

/** GET /api/numbering-sync/uis — UIS stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ settings: await getUisSyncView() });
}
