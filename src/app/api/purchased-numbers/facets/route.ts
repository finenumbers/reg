import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { freeNumbersErrorResponse } from "@/modules/free-numbers/http";
import { parsePurchasedNumbersFacetQuery } from "@/modules/purchased-numbers/query";
import { listPurchasedNumberFacets } from "@/modules/purchased-numbers/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/purchased-numbers/facets — one visible column, other filters applied.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  try {
    const query = parsePurchasedNumbersFacetQuery(new URL(request.url).searchParams);
    const data = await listPurchasedNumberFacets(query);
    return NextResponse.json(data);
  } catch (error) {
    return freeNumbersErrorResponse(error);
  }
}
