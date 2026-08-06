import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { listAuditLogs } from "@/modules/audit/query";

/**
 * GET /api/audit — admin/security audit events.
 * Protected with audit:read. Meta is sanitized; secrets never returned.
 * Query: action (substring), actor (username substring), page, pageSize.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("audit:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? undefined;
  const actor = url.searchParams.get("actor") ?? undefined;
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");

  const result = await listAuditLogs({
    action,
    actor,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 100,
  });

  return NextResponse.json(result);
}
