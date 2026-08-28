import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { findActiveMonthExport } from "@/modules/traffic/month-export-job";

export const runtime = "nodejs";

/**
 * GET /api/traffic/export/active — the caller's in-flight export, if any.
 */
export async function GET() {
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

  return NextResponse.json({ job: findActiveMonthExport(userId) });
}
