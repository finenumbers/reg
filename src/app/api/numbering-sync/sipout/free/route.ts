import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getNumberingSyncView, startSipoutFree } from "@/modules/numbering-sync/service";

/** POST /api/numbering-sync/sipout/free — free SipOut numbers. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startSipoutFree({ userId: actor.userId, ip: actor.ip });
  const settings = await getNumberingSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
