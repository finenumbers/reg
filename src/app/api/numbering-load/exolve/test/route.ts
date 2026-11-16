import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { getExolveAccessView, testExolveAccess } from "@/modules/exolve/service";

/** POST /api/numbering-load/exolve/test — purchased page, directory, one free cell. Session only. */
export async function POST(request: Request) {
  const actor = await numberingLoadActor(request);
  if (!actor.ok) return actor.response;
  const result = await testExolveAccess({ userId: actor.userId, ip: actor.ip });
  const settings = await getExolveAccessView();
  if (!result.ok) return numberingLoadJson({ error: result.error, settings }, 400);
  return numberingLoadJson({ ok: true, settings });
}
