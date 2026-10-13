import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { listSmgCalls } from "@/modules/smg/service";
import { cdrVacuumBusyResponse } from "@/modules/storage/vacuum/http";

/**
 * GET /api/smg — list Eltex SMG CDR rows for one calendar month.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;
  const busy = cdrVacuumBusyResponse();
  if (busy) return busy;

  const url = new URL(request.url);
  const data = await listSmgCalls({
    filters: parseFiltersParam(url.searchParams.get("filters")),
    phoneQ: url.searchParams.get("phoneQ") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    page: Number(url.searchParams.get("page") ?? "1"),
  });
  return NextResponse.json(data);
}
