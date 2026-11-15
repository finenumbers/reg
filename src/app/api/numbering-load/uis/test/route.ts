import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { getUisAccessView, testUisAccess } from "@/modules/uis/service";

/** POST /api/numbering-load/uis/test — one page and one prefix probe of each list. Session only. */
export async function POST(request: Request) {
  const actor = await numberingLoadActor(request);
  if (!actor.ok) return actor.response;
  const result = await testUisAccess({ userId: actor.userId, ip: actor.ip });
  const settings = await getUisAccessView();
  if (!result.ok) return numberingLoadJson({ error: result.error, settings }, 400);
  return numberingLoadJson({ ok: true, settings });
}
