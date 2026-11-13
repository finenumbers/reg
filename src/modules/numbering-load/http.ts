/**
 * Session-only SipOut access routes. An API key cannot call them.
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { sipoutKeySaveSchema } from "@/modules/numbering-load/schemas";
import { saveSipoutKey } from "@/modules/numbering-load/service";

const PRIVATE = { "Cache-Control": "private, no-store" };

export async function numberingLoadActor(request: Request): Promise<
  | { ok: true; userId: string; ip: string | null }
  | { ok: false; response: NextResponse }
> {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin;
  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate;
  try {
    const userId = requireSessionUserId(gate.ctx);
    return { ok: true, userId, ip: await getRequestIp() };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden", code: "FORBIDDEN" },
        { status: 403, headers: PRIVATE },
      ),
    };
  }
}

export function numberingLoadJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE });
}

/** PUT /api/numbering-load — replace the SipOut key. */
export async function putSipoutKey(request: Request): Promise<NextResponse> {
  const actor = await numberingLoadActor(request);
  if (!actor.ok) return actor.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return numberingLoadJson({ error: "Некорректный запрос." }, 400);
  }
  try {
    const input = sipoutKeySaveSchema.parse(body);
    const saved = await saveSipoutKey(input.token, {
      userId: actor.userId,
      ip: actor.ip,
    });
    if (!saved.ok) return numberingLoadJson({ error: saved.error }, 409);
    return numberingLoadJson({ settings: saved.settings });
  } catch (error) {
    if (error instanceof ZodError) return numberingLoadJson({ error: "Проверьте ключ." }, 400);
    return numberingLoadJson({ error: "Не удалось сохранить настройки." }, 500);
  }
}
