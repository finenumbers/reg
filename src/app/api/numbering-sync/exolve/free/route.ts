import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getExolveSyncView, startExolveFree } from "@/modules/exolve/service";

/** POST /api/numbering-sync/exolve/free — free catalog only. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startExolveFree({ userId: actor.userId, ip: actor.ip });
  const settings = await getExolveSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
