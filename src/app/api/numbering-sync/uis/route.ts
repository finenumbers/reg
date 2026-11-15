import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getUisSyncView, startUisSync } from "@/modules/uis/service";

/** GET /api/numbering-sync/uis — UIS stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ settings: await getUisSyncView() });
}

/** POST /api/numbering-sync/uis — one UIS stage for both catalogs. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startUisSync({ userId: actor.userId, ip: actor.ip });
  const settings = await getUisSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
