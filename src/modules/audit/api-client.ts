/**
 * Browser fetch helpers for protected audit APIs.
 */

import type { ListAuditLogsResult } from "@/modules/audit/query";
import {
  buildAuditListUrl,
  type AuditListQuery,
} from "@/modules/audit/ui-format";

export type FetchAuditListResult =
  | { ok: true; data: ListAuditLogsResult }
  | { ok: false; status: number; message: string };

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return err;
  }
  return fallback;
}

export async function fetchAuditList(
  query: AuditListQuery = {},
  init?: RequestInit,
): Promise<FetchAuditListResult> {
  const res = await fetch(buildAuditListUrl(query), {
    ...init,
    method: "GET",
    cache: "no-store",
  });
  const body = await readJson(res);

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: errorMessage(
        body,
        res.status === 403
          ? "You do not have permission to view the audit log"
          : "Failed to load audit events",
      ),
    };
  }

  return { ok: true, data: body as ListAuditLogsResult };
}
