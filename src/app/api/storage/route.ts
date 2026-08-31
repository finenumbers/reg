import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { listStorageSnapshot } from "@/modules/storage/service";

/**
 * GET /api/storage — CDR month storage summary (admin).
 */
export async function GET() {
  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;

  const data = await listStorageSnapshot();
  return NextResponse.json(data);
}
