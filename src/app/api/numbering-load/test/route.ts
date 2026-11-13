import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { getNumberingLoadView, testSipoutAccess } from "@/modules/numbering-load/service";

/** POST /api/numbering-load/test — one get_cities. Session only. */
export async function POST(request: Request) {
  const actor = await numberingLoadActor(request);
  if (!actor.ok) return actor.response;
  const result = await testSipoutAccess({ userId: actor.userId, ip: actor.ip });
  const settings = await getNumberingLoadView();
  if (!result.ok) return numberingLoadJson({ error: result.error, settings }, 400);
  return numberingLoadJson({ ok: true, settings });
}
