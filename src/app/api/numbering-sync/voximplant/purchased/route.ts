import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import {
  getVoximplantSyncView,
  startVoximplantPurchased,
} from "@/modules/voximplant/service";

/** POST /api/numbering-sync/voximplant/purchased — purchased catalog only. Session only. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startVoximplantPurchased({ userId: actor.userId, ip: actor.ip });
  const settings = await getVoximplantSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
