import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getNumberingSyncView, startSipoutSync } from "@/modules/numbering-sync/service";

/** POST /api/numbering-sync/sipout — one SipOut stage. The body is ignored. Session only. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startSipoutSync({ userId: actor.userId, ip: actor.ip });
  const settings = await getNumberingSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
