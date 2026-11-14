import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getRunexisSyncView, startRunexisSync } from "@/modules/runexis/service";

/** GET /api/numbering-sync/runexis — Runexis stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ settings: await getRunexisSyncView() });
}

/** POST /api/numbering-sync/runexis — one Runexis free-number stage. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startRunexisSync({ userId: actor.userId, ip: actor.ip });
  const settings = await getRunexisSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
