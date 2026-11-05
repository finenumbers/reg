/**
 * Browser fetch helpers for the routing-groups catalog.
 */

import type {
  GroupsOperationalStatus,
  ListRoutingGroupsResult,
} from "@/modules/groups/service";

export type FetchGroupsResult =
  | { ok: true; data: ListRoutingGroupsResult }
  | { ok: false; status: number; message: string };

export type FetchGroupsStatusResult =
  | { ok: true; data: GroupsOperationalStatus }
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

export async function fetchGroups(init?: RequestInit): Promise<FetchGroupsResult> {
  const res = await fetch("/api/groups", { ...init, method: "GET", cache: "no-store" });
  const body = await readJson(res);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: errorMessage(body, "Не удалось загрузить входящие группы"),
    };
  }
  return { ok: true, data: body as ListRoutingGroupsResult };
}

export async function fetchGroupsStatus(
  init?: RequestInit,
): Promise<FetchGroupsStatusResult> {
  const res = await fetch("/api/groups/status", {
    ...init,
    method: "GET",
    cache: "no-store",
  });
  const body = await readJson(res);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: errorMessage(body, "Не удалось получить статус групп"),
    };
  }
  return { ok: true, data: body as GroupsOperationalStatus };
}
