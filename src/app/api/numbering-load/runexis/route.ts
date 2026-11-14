import { ZodError } from "zod";
import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { runexisAccessSaveSchema } from "@/modules/runexis/schemas";
import { getRunexisAccessView, saveRunexisAccess } from "@/modules/runexis/service";

/** PUT /api/numbering-load/runexis — store the Runexis login. Session only. */
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
    const input = runexisAccessSaveSchema.parse(body);
    const saved = await saveRunexisAccess(
      { email: input.email, password: input.password },
      { userId: actor.userId, ip: actor.ip },
    );
    if (!saved.ok)
      return numberingLoadJson(
        { error: saved.error, settings: await getRunexisAccessView() },
        409,
      );
    return numberingLoadJson({ settings: saved.settings });
  } catch (error) {
    if (error instanceof ZodError) {
      return numberingLoadJson({ error: "Проверьте email и пароль." }, 400);
    }
    return numberingLoadJson({ error: "Не удалось сохранить настройки." }, 500);
  }
}
