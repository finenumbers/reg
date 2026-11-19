import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getMcnSyncView } from "@/modules/mcn/service";

/** GET /api/numbering-sync/mcn — MCN Telecom stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ settings: await getMcnSyncView() });
}
