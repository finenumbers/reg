import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getVoximplantSyncView, startVoximplantSync } from "@/modules/voximplant/service";

/** GET /api/numbering-sync/voximplant — Voximplant stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ settings: await getVoximplantSyncView() });
}

/** POST /api/numbering-sync/voximplant — one stage for both catalogs. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startVoximplantSync({ userId: actor.userId, ip: actor.ip });
  const settings = await getVoximplantSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
