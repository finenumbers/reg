import { NextResponse } from "next/server";
import { listNumberMasks } from "@/modules/masks/service";
import { requireTariffSession } from "@/modules/tariffs/guard";

/**
 * GET /api/masks — current mask snapshot. Session + phones:read.
 * API keys are rejected.
 */
export async function GET(request: Request) {
  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");

  const data = await listNumberMasks({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 100,
  });

  return NextResponse.json(data);
}
