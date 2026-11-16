import { ZodError } from "zod";
import { numberingLoadActor, numberingLoadJson } from "@/modules/numbering-load/http";
import { exolveAccessSaveSchema } from "@/modules/exolve/schemas";
import { getExolveAccessView, saveExolveAccess } from "@/modules/exolve/service";

/** PUT /api/numbering-load/exolve — store the MTS Exolve key. Session only. */
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
    const input = exolveAccessSaveSchema.parse(body);
    const saved = await saveExolveAccess(input.token, {
      userId: actor.userId,
      ip: actor.ip,
    });
    if (!saved.ok) {
      return numberingLoadJson(
        { error: saved.error, settings: await getExolveAccessView() },
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
