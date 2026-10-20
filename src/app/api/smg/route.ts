import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { listSmgCalls } from "@/modules/smg/service";
import { parseTimeSort } from "@/modules/traffic/traffic-sort";
import { cdrVacuumBusyResponse } from "@/modules/storage/vacuum/http";

/**
 * GET /api/smg — list Eltex SMG CDR rows for one gateway and calendar month.
 * `devices=1` recounts the gateway menu. A missing device does that too.
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
    device: url.searchParams.get("device") ?? undefined,
    includeDevices: url.searchParams.get("devices") === "1",
    page: Number(url.searchParams.get("page") ?? "1"),
    setupSort: parseTimeSort(url.searchParams.get("setupSort")),
  });
  return NextResponse.json(data);
}
