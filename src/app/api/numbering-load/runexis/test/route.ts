import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { getRunexisAccessView, testRunexisAccess } from "@/modules/runexis/service";

/** POST /api/numbering-load/runexis/test — login, the first partner page, the code directory, then one showcase page of its first code. Session only. */
export async function POST(request: Request) {
  const actor = await numberingLoadActor(request);
  if (!actor.ok) return actor.response;
  const result = await testRunexisAccess({ userId: actor.userId, ip: actor.ip });
  const settings = await getRunexisAccessView();
  if (!result.ok) return numberingLoadJson({ error: result.error, settings }, 400);
  return numberingLoadJson({ ok: true, settings });
}
