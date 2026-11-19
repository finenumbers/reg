import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getMcnSyncView, startMcnFree } from "@/modules/mcn/service";

/** POST /api/numbering-sync/mcn/free — free catalog only. The body is ignored. Session only. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startMcnFree({ userId: actor.userId, ip: actor.ip });
  const settings = await getMcnSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
