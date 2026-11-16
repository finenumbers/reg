import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import {
  getVoximplantAccessView,
  testVoximplantAccess,
} from "@/modules/voximplant/service";

/** POST /api/numbering-load/voximplant/test — one purchased page, categories, one free page. */
export async function POST(request: Request) {
  const actor = await numberingLoadActor(request);
  if (!actor.ok) return actor.response;
  const result = await testVoximplantAccess({ userId: actor.userId, ip: actor.ip });
  const settings = await getVoximplantAccessView();
  if (!result.ok) return numberingLoadJson({ error: result.error, settings }, 400);
  return numberingLoadJson({ ok: true, settings });
}
