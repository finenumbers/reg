import { ZodError } from "zod";
import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { voximplantAccessSaveSchema } from "@/modules/voximplant/schemas";
import {
  getVoximplantAccessView,
  saveVoximplantAccess,
} from "@/modules/voximplant/service";

/** PUT /api/numbering-load/voximplant — store the service account. Session only. */
export async function PUT(request: Request) {
  const actor = await numberingLoadActor(request);
  if (!actor.ok) return actor.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return numberingLoadJson({ error: "Некорректный запрос." }, 400);
  }
  try {
    const input = voximplantAccessSaveSchema.parse(body);
    const saved = await saveVoximplantAccess(input.credentials, {
      userId: actor.userId,
      ip: actor.ip,
    });
    if (!saved.ok) {
      return numberingLoadJson(
        { error: saved.error, settings: await getVoximplantAccessView() },
        409,
      );
    }
    return numberingLoadJson({ settings: saved.settings });
  } catch (error) {
    if (error instanceof ZodError) {
      return numberingLoadJson({ error: "Проверьте ключ." }, 400);
    }
    return numberingLoadJson({ error: "Не удалось сохранить настройки." }, 500);
  }
}
