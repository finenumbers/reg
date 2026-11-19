import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getVoximplantSyncView } from "@/modules/voximplant/service";

/** GET /api/numbering-sync/voximplant — Voximplant stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ settings: await getVoximplantSyncView() });
}
