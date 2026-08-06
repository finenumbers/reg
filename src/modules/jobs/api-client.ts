/**
 * Browser fetch helpers for protected jobs APIs.
 */

import type { ListJobRunsResult } from "@/modules/jobs/query";
import {
  buildJobsListUrl,
  type JobsListQuery,
} from "@/modules/jobs/ui-format";

export type FetchJobsListResult =
  | { ok: true; data: ListJobRunsResult }
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

export async function fetchJobsList(
  query: JobsListQuery = {},
  init?: RequestInit,
): Promise<FetchJobsListResult> {
  const res = await fetch(buildJobsListUrl(query), {
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
          ? "You do not have permission to view jobs"
          : "Failed to load job runs",
      ),
    };
  }

  return { ok: true, data: body as ListJobRunsResult };
}
