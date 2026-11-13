/**
 * Session-only save for one numbering source. The caller picks the save function.
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { NumberingLoadError } from "@/modules/numbering-load/service";
import {
  numberingSourceSaveSchema,
  type NumberingLoadView,
  type NumberingSourceSaveInput,
} from "@/modules/numbering-load/schemas";

const PRIVATE = { "Cache-Control": "private, no-store" };

export async function putNumberingSource(
  request: Request,
  save: (
    input: NumberingSourceSaveInput,
    actor: { userId: string; ip?: string | null },
  ) => Promise<NumberingLoadView>,
): Promise<NextResponse> {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;

  let userId: string;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403, headers: PRIVATE },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Некорректный запрос." },
      { status: 400, headers: PRIVATE },
    );
  }

  let input: NumberingSourceSaveInput;
  try {
    input = numberingSourceSaveSchema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Проверьте адрес и токен." },
        { status: 400, headers: PRIVATE },
      );
    }
    throw error;
  }

  try {
    const settings = await save(input, { userId, ip: await getRequestIp() });
    return NextResponse.json({ settings }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof NumberingLoadError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: PRIVATE },
      );
    }
    return NextResponse.json(
      { error: "Не удалось сохранить настройки." },
      { status: 500, headers: PRIVATE },
    );
  }
}
