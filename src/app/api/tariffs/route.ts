import { NextResponse } from "next/server";
import { requireTariffSession } from "@/modules/tariffs/guard";
import { listTariffRates } from "@/modules/tariffs/service";

/**
 * GET /api/tariffs — current tariff snapshot. Session + phones:read.
 * API keys are rejected.
 */
export async function GET(request: Request) {
  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");

  const data = await listTariffRates({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 100,
  });

  return NextResponse.json(data);
}
