import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import {
  dismissFinishedMonthExport,
  getMonthExportForOwner,
  toJobView,
} from "@/modules/traffic/month-export-job";

export const runtime = "nodejs";

/**
 * GET /api/traffic/export/:id — job status for the owner.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  let userId: string;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const job = getMonthExportForOwner(id, userId);
  if (!job) {
    return NextResponse.json(
      { error: "Задача не найдена", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  return NextResponse.json({ job: toJobView(job) });
}

/**
 * DELETE /api/traffic/export/:id — drop a finished job and its files.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  let userId: string;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const result = await dismissFinishedMonthExport(id, userId);
  if (result === "not_found") {
    return NextResponse.json(
      { error: "Задача не найдена", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  if (result === "active") {
    return NextResponse.json(
      { error: "Нельзя закрыть выполняющуюся выгрузку", code: "CONFLICT" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
