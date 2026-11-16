import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getAuroraSyncView, startAuroraSync } from "@/modules/aurora/service";

export const runtime = "nodejs";

/** GET /api/numbering-sync/aurora — Aurora stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ settings: await getAuroraSyncView() });
}

/** POST /api/numbering-sync/aurora — read the saved CSV set. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startAuroraSync({ userId: actor.userId, ip: actor.ip });
  const settings = await getAuroraSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
