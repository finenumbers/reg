import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { parseTrafficFlagParam } from "@/modules/traffic/row-flags";
import { listTraffic } from "@/modules/traffic/service";
import { parseTimeSort } from "@/modules/traffic/traffic-sort";

/**
 * GET /api/traffic — list CDR records from local DB.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const filters = parseFiltersParam(url.searchParams.get("filters"));
  const phoneQ = url.searchParams.get("phoneQ") ?? undefined;
  const month = url.searchParams.get("month") ?? undefined;
  const phantom = parseTrafficFlagParam(url.searchParams.get("phantom"));
  const callErrors = parseTrafficFlagParam(url.searchParams.get("callErrors"));
  const timeSort = parseTimeSort(url.searchParams.get("timeSort"));
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");

  const data = await listTraffic({
    filters,
    phoneQ,
    month,
    phantom,
    callErrors,
    timeSort,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 100,
  });

  return NextResponse.json(data);
}
