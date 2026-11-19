import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getMcnSyncView, startMcnPurchased } from "@/modules/mcn/service";

/** POST /api/numbering-sync/mcn/purchased — purchased catalog only. The body is ignored. Session only. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startMcnPurchased({ userId: actor.userId, ip: actor.ip });
  const settings = await getMcnSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
