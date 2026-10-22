import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { readSmgExportJob } from "@/modules/smg/export-job";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/smg/export/:id — whether the xlsx is still building. */
export async function GET(_request: Request, context: RouteContext) {
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
  const job = readSmgExportJob(id, userId);
  if (!job) {
    return NextResponse.json({ error: "Задача не найдена", code: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ job });
}
