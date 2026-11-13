/**
 * Local statement timeout. The pool connection must not keep it.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  MARKING_LOCK_ERROR,
  MARKING_READ_ERROR,
} from "@/modules/marking/payload";

export const MARKING_LIST_TIMEOUT = "15s";
export const MARKING_WRITE_TIMEOUT = "30s";

type ReadHttpError = { status: 409 | 503; error: string };

export function isMarkingLockTimeout(error: unknown): boolean {
  const message = errorText(error);
  const code = errorCode(error);
  return code === "55P03" || message.includes("55P03") || /lock timeout/i.test(message);
}

export function isMarkingStatementTimeout(error: unknown): boolean {
  const message = errorText(error);
  const code = errorCode(error);
  return code === "57014" || message.includes("57014") || /statement timeout/i.test(message);
}

export function markingReadHttpError(error: unknown): ReadHttpError | null {
  if (isMarkingLockTimeout(error)) return { status: 409, error: MARKING_LOCK_ERROR };
  if (isMarkingStatementTimeout(error)) return { status: 503, error: MARKING_READ_ERROR };
  return null;
}

export async function withMarkingTimeout<T>(
  statementTimeout: string,
  transactionTimeoutMs: number,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${statementTimeout}, true)`;
      return run(tx);
    },
    { maxWait: 5_000, timeout: transactionTimeoutMs },
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as { code?: unknown; meta?: { code?: unknown } };
  if (typeof record.code === "string") return record.code;
  if (typeof record.meta?.code === "string") return record.meta.code;
  return "";
}
