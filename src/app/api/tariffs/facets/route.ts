import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireTariffSession } from "@/modules/tariffs/guard";
import { isTariffColumn } from "@/modules/tariffs/query-filter";
import { listTariffFacets } from "@/modules/tariffs/service";

/**
 * GET /api/tariffs/facets — values of one column over the whole snapshot.
 * Session + phones:read. API keys are rejected. Does not rate calls.
 */
export async function GET(request: Request) {
  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const column = url.searchParams.get("column")?.trim() ?? "";
  if (!isTariffColumn(column)) {
    return NextResponse.json(
      { error: "Invalid or missing column", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const filters = parseFiltersParam(url.searchParams.get("filters"));
  const q = url.searchParams.get("q") ?? undefined;
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200;

  const data = await listTariffFacets({ column, filters, q, limit });
  return NextResponse.json(data);
}