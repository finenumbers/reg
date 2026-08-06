import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { listPhoneFacets } from "@/modules/phones/service";
import { parsePhoneKind } from "@/modules/phones/types";

/**
 * GET /api/phones/facets — distinct values + counts for one column (cross-filter aware).
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const column = url.searchParams.get("column")?.trim() ?? "";
  if (!column) {
    return NextResponse.json(
      { error: "column is required", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const kind = parsePhoneKind(url.searchParams.get("kind"));
  const filters = parseFiltersParam(url.searchParams.get("filters"));
  const q = url.searchParams.get("q") ?? undefined;
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200;

  const data = await listPhoneFacets({
    kind,
    column,
    filters,
    q,
    limit,
  });

  return NextResponse.json(data);
}
