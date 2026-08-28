import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { assertJobOwner } from "@/modules/enrich/jobs";

/**
 * GET /api/enrich/:id — job status for the owner.
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
  const job = await assertJobOwner(id, userId);
  if (!job) {
    return NextResponse.json(
      { error: "Задача не найдена", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  return NextResponse.json({ job });
}
