import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { freeNumbersErrorResponse } from "@/modules/free-numbers/http";
import { parseFreeNumbersListQuery } from "@/modules/free-numbers/query";
import { listFreeNumbers } from "@/modules/free-numbers/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/free-numbers — local free-number catalog. Session or phones:read key.
 * Optional: filters, phoneQ, page, pageSize.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  try {
    const query = parseFreeNumbersListQuery(new URL(request.url).searchParams);
    const data = await listFreeNumbers(query);
    return NextResponse.json(data);
  } catch (error) {
    return freeNumbersErrorResponse(error);
  }
}
