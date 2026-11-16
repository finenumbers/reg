import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getMcnSyncView, startMcnSync } from "@/modules/mcn/service";

/** GET /api/numbering-sync/mcn — MCN Telecom stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ settings: await getMcnSyncView() });
}

/** POST /api/numbering-sync/mcn — one stage for both catalogs. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startMcnSync({ userId: actor.userId, ip: actor.ip });
  const settings = await getMcnSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
