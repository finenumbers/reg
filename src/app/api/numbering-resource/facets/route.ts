import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { getRequestIp } from "@/lib/request-ip";
import { numberingErrorResponse, numberingJson } from "@/modules/numbering-resource/http";
import { parseNumberingFacetQuery } from "@/modules/numbering-resource/filters";
import { listNumberingFacets } from "@/modules/numbering-resource/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/numbering-resource/facets — one current-dataset column.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  try {
    const query = parseNumberingFacetQuery(new URL(request.url).searchParams);
    const data = await listNumberingFacets(query, {
      signal: request.signal,
      clientIp: await getRequestIp(),
    });
    return numberingJson(data);
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    return numberingErrorResponse(error);
  }
}
