import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { getRadiusLoadAge } from "@/modules/antifraud/service";

/** GET /api/antifraud/status — time since the last new calls.log bytes. */
export async function GET() {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;
  return NextResponse.json(await getRadiusLoadAge());
}
