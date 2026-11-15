import { ZodError } from "zod";
import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { uisAccessSaveSchema } from "@/modules/uis/schemas";
import { getUisAccessView, saveUisAccess } from "@/modules/uis/service";

/** PUT /api/numbering-load/uis — store the UIS key. Session only. */
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
    const input = uisAccessSaveSchema.parse(body);
    const saved = await saveUisAccess(input.token, {
      userId: actor.userId,
      ip: actor.ip,
    });
    if (!saved.ok) {
      return numberingLoadJson(
        { error: saved.error, settings: await getUisAccessView() },
        409,
      );
    }
    return numberingLoadJson({ settings: saved.settings });
  } catch (error) {
    if (error instanceof ZodError)
      return numberingLoadJson({ error: "Проверьте ключ." }, 400);
    return numberingLoadJson({ error: "Не удалось сохранить настройки." }, 500);
  }
}
