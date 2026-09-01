import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { listDetailSnapshot } from "@/modules/detail/service";

/**
 * GET /api/detail — monthly client CDR slices (phones:read).
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? undefined;
  const data = await listDetailSnapshot(month);
  return NextResponse.json(data);
}
