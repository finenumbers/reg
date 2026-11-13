import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { getNumberingSyncView, testSipoutAccess } from "@/modules/numbering-sync/service";

/** POST /api/numbering-sync/test — one get_cities. Session only. */
export async function POST(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const result = await testSipoutAccess({ userId: actor.userId, ip: actor.ip });
  const settings = await getNumberingSyncView();
  if (!result.ok) return numberingSyncJson({ error: result.error, settings }, 400);
  return numberingSyncJson({ ok: true, settings });
}
