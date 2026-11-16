import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getExolveSyncView, startExolveSync } from "@/modules/exolve/service";

/** GET /api/numbering-sync/exolve — MTS Exolve stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ settings: await getExolveSyncView() });
}

/** POST /api/numbering-sync/exolve — one stage for both catalogs. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startExolveSync({ userId: actor.userId, ip: actor.ip });
  const settings = await getExolveSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
