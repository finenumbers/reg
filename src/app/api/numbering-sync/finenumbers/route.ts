import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getFinenumbersSyncView, startFinenumbersSync } from "@/modules/finenumbers/service";

/** GET /api/numbering-sync/finenumbers — Finenumbers stage status. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  return numberingSyncJson({ settings: await getFinenumbersSyncView() });
}

/** POST /api/numbering-sync/finenumbers — one stage for both catalogs. The body is ignored. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await startFinenumbersSync({ userId: actor.userId, ip: actor.ip });
  const settings = await getFinenumbersSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 409);
  return numberingSyncJson({ ok: true, settings });
}
