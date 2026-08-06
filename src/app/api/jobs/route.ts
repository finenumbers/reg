import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { listJobRuns } from "@/modules/jobs/query";
import type { JobStatus } from "@/generated/prisma/client";

/**
 * GET /api/jobs — recent job runs for operator diagnostics.
 * Protected with regs:read. Never exposes SSH secrets or raw key material.
 * Query: status, actionCode, page, pageSize. Sorted by startedAt desc.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("regs:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const actionCode = url.searchParams.get("actionCode") ?? undefined;
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");

  let status: JobStatus | undefined;
  if (
    statusParam === "running" ||
    statusParam === "success" ||
    statusParam === "failed"
  ) {
    status = statusParam;
  } else if (statusParam) {
    return NextResponse.json(
      { error: "Invalid status filter", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const result = await listJobRuns({
    status,
    actionCode,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 100,
  });

  return NextResponse.json(result);
}
