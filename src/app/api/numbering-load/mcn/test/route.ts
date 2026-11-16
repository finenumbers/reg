import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { getMcnAccessView, testMcnAccess } from "@/modules/mcn/service";

/** POST /api/numbering-load/mcn/test — one purchased page, countries, one free page. */
export async function POST(request: Request) {
  const actor = await numberingLoadActor(request);
  if (!actor.ok) return actor.response;
  const result = await testMcnAccess({ userId: actor.userId, ip: actor.ip });
  const settings = await getMcnAccessView();
  if (!result.ok) return numberingLoadJson({ error: result.error, settings }, 400);
  return numberingLoadJson({ ok: true, settings });
}
