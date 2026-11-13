/**
 * Session-only SipOut routes. An API key cannot call them.
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import type { NumberingSyncView } from "@/modules/numbering-sync/service";

const PRIVATE = { "Cache-Control": "private, no-store" };

export async function numberingSyncActor(
  request: Request,
): Promise<
  { ok: true; userId: string; ip: string | null } | { ok: false; response: NextResponse }
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

export function numberingSyncJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE });
}

export function numberingSyncError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return numberingSyncJson({ error: "Проверьте ключ." }, 400);
  }
  return numberingSyncJson({ error: "Не удалось сохранить настройки." }, 500);
}

export type { NumberingSyncView };
