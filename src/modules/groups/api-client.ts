/**
 * Browser helpers for incoming groups APIs.
 */

import {
  interpretSyncResponse,
  type PhonesSyncStatusSnapshot,
  type SyncApiResult,
} from "@/modules/phones/request-action";
import type {
  GroupsOperationalStatus,
  ListRoutingGroupsResult,
} from "@/modules/groups/service";

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

export async function fetchGroupsList(): Promise<
  | { ok: true; data: ListRoutingGroupsResult }
  | { ok: false; status: number; message: string }
> {
  const res = await fetch("/api/groups", { cache: "no-store" });
  const body = await readJson(res);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: errorMessage(body, "Не удалось загрузить группы"),
    };
  }
  return { ok: true, data: body as ListRoutingGroupsResult };
}

export async function fetchGroupsStatus(): Promise<
  | { ok: true; data: GroupsOperationalStatus }
  | { ok: false; status: number; message: string }
> {
  const res = await fetch("/api/groups/status", { cache: "no-store" });
  const body = await readJson(res);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: errorMessage(body, "Не удалось получить статус"),
    };
  }
  return { ok: true, data: body as GroupsOperationalStatus };
}

export async function postGroupsRequest(): Promise<SyncApiResult> {
  const res = await fetch("/api/groups/request", {
    method: "POST",
    cache: "no-store",
  });
  const body = await readJson(res);
  return interpretSyncResponse(res.status, body);
}

export function toGroupsSyncStatusSnapshot(
  data: GroupsOperationalStatus,
): PhonesSyncStatusSnapshot {
  return {
    lastJobStatus: data.lastJobStatus,
    lastError: data.lastError,
    lastFinishedAt: data.lastSyncedAt,
    runningCount: data.runningCount,
    lastFailedError: data.lastFailedError,
  };
}
