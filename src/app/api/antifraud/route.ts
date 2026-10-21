import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { listRadiusCalls } from "@/modules/antifraud/service";
import { parseTimeSort } from "@/modules/traffic/traffic-sort";

/** GET /api/antifraud — Parking calls.log rows from the local database. */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");
  const data = await listRadiusCalls({
    filters: parseFiltersParam(url.searchParams.get("filters")),
    phoneQ: url.searchParams.get("phoneQ") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    timeSort: parseTimeSort(url.searchParams.get("timeSort")),
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 100,
  });
  return NextResponse.json(data);
}
