import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { purchasedNumbersErrorResponse } from "@/modules/purchased-numbers/http";
import { parsePurchasedNumbersListQuery } from "@/modules/purchased-numbers/query";
import { listPurchasedNumbers } from "@/modules/purchased-numbers/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/purchased-numbers — local purchased-number catalog.
 * Session or phones:read key.
 * Optional: filters, phoneQ, page, pageSize.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  try {
    const query = parsePurchasedNumbersListQuery(new URL(request.url).searchParams);
    const data = await listPurchasedNumbers(query);
    return NextResponse.json(data);
  } catch (error) {
    return purchasedNumbersErrorResponse(error);
  }
}
