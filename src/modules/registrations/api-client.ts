/**
 * Browser fetch helpers for protected registrations APIs.
 * Never calls Prisma / SSH directly from the client.
 */

import type {
  RegistrationDetailResult,
  ListRegistrationsResult,
} from "@/modules/registrations/service";
import {
  buildRegsListUrl,
  type RegsListQuery,
} from "@/modules/registrations/ui-format";
import {
  interpretPollResponse,
  type PollApiResult,
  type RegsPollStatusSnapshot,
} from "@/modules/registrations/poll-action";
import type { RegistrationsOperationalStatus } from "@/modules/registrations/status";

export type FetchRegsListResult =
  | { ok: true; data: ListRegistrationsResult }
  | { ok: false; status: number; message: string };

export type FetchRegsDetailResult =
  | { ok: true; data: RegistrationDetailResult }
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

export async function fetchRegsList(
  query: RegsListQuery = {},
  init?: RequestInit,
): Promise<FetchRegsListResult> {
  const res = await fetch(buildRegsListUrl(query), {
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
          ? "You do not have permission to view registrations"
          : "Failed to load registrations",
      ),
    };
  }

  return { ok: true, data: body as ListRegistrationsResult };
}

export async function fetchRegsDetail(
  phone: string,
  init?: RequestInit,
): Promise<FetchRegsDetailResult> {
  const encoded = encodeURIComponent(phone.trim());
  const res = await fetch(`/api/regs/${encoded}`, {
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
        res.status === 404
          ? "Registration not found"
          : "Failed to load registration detail",
      ),
    };
  }

  return { ok: true, data: body as RegistrationDetailResult };
}

export async function postRegsPoll(init?: RequestInit): Promise<PollApiResult> {
  const res = await fetch("/api/regs/poll", {
    ...init,
    method: "POST",
  });
  const body = (await readJson(res)) as {
    accepted?: boolean;
    message?: string;
    reason?: string;
    error?: string;
  } | null;
  return interpretPollResponse(res.status, body);
}

export type FetchRegsStatusResult =
  | { ok: true; data: RegistrationsOperationalStatus }
  | { ok: false; status: number; message: string };

export async function fetchRegsStatus(
  init?: RequestInit,
): Promise<FetchRegsStatusResult> {
  const res = await fetch("/api/regs/status", {
    ...init,
    method: "GET",
    cache: "no-store",
  });
  const body = await readJson(res);

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: errorMessage(body, "Не удалось получить статус опроса"),
    };
  }

  return { ok: true, data: body as RegistrationsOperationalStatus };
}

/** Narrow status payload for waitForRegsPollOutcome. */
export function toPollStatusSnapshot(
  data: RegistrationsOperationalStatus,
): RegsPollStatusSnapshot {
  return {
    lastJobStatus: data.lastJobStatus,
    lastError: data.lastError,
    lastFinishedAt: data.lastFinishedAt,
    runningCount: data.runningCount,
    lastFailedError: data.lastFailedError,
  };
}
