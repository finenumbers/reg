import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { getRequestIp } from "@/lib/request-ip";
import { numberingErrorResponse, numberingJson } from "@/modules/numbering-resource/http";
import { parseNumberingSummaryQuery } from "@/modules/numbering-resource/filters";
import { summarizeNumberingResource } from "@/modules/numbering-resource/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/numbering-resource/summary — filtered and global counts for the current dataset.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  try {
    const filters = parseNumberingSummaryQuery(new URL(request.url).searchParams);
    const data = await summarizeNumberingResource(filters, {
      signal: request.signal,
      clientIp: await getRequestIp(),
    });
    return numberingJson(data);
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    return numberingErrorResponse(error);
  }
}
