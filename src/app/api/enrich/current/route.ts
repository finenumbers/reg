import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { getCurrentEnrichJob } from "@/modules/enrich/jobs";

/**
 * GET /api/enrich/current — latest job for the signed-in user.
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

  const job = await getCurrentEnrichJob(userId);
  return NextResponse.json({ job });
}
