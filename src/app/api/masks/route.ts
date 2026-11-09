import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { listNumberMasks } from "@/modules/masks/service";
import { requireTariffSession } from "@/modules/tariffs/guard";

/**
 * GET /api/masks — current mask snapshot. Session + phones:read.
 * API keys are rejected. `filters` is applied to the whole snapshot, then paged.
 */
export async function GET(request: Request) {
  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");
  const filters = parseFiltersParam(url.searchParams.get("filters"));

  const data = await listNumberMasks({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 100,
    filters,
  });

  return NextResponse.json(data);
}
