import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { isMarkingColumn } from "@/modules/marking/query-filter";
import { listMarkingFacets, mapMarkingReadError } from "@/modules/marking/service";
import { requireTariffSession } from "@/modules/tariffs/guard";

/**
 * GET /api/marking/facets — values of one column over the whole snapshot.
 * Session + phones:read. API keys are rejected.
 */
export async function GET(request: Request) {
  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const column = url.searchParams.get("column")?.trim() ?? "";
  if (!isMarkingColumn(column)) {
    return NextResponse.json(
      { error: "Invalid or missing column", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const filters = parseFiltersParam(url.searchParams.get("filters"));
  const q = url.searchParams.get("q") ?? undefined;
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200;

  try {
    const data = await listMarkingFacets({ column, filters, q, limit });
    return NextResponse.json(data);
  } catch (error) {
    const mapped = mapMarkingReadError(error);
    if (mapped) {
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    throw error;
  }
}
