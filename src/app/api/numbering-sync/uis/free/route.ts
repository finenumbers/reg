import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getUisSyncView, startUisFree } from "@/modules/uis/service";

/** POST /api/numbering-sync/uis/free — free UIS numbers. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startUisFree({ userId: actor.userId, ip: actor.ip });
  const settings = await getUisSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
