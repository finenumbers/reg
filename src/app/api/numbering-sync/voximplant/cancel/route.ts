import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import {
  cancelVoximplantSync,
  getVoximplantSyncView,
} from "@/modules/voximplant/service";

/** POST /api/numbering-sync/voximplant/cancel — stop a walk before it publishes. Session only. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await cancelVoximplantSync();
  const settings = await getVoximplantSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
