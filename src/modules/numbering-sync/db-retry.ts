/**
 * Short database blips must not throw away a SipOut draft.
 * A statement timeout is not retried: the work already ran too long.
 */

const ATTEMPTS = 5;

function errorText(error: unknown, depth = 0): string {
  if (!error || typeof error !== "object" || depth > 4) return "";
  const record = error as {
    code?: unknown;
    message?: unknown;
    meta?: unknown;
    cause?: unknown;
  };
  const parts: string[] = [];
  if (typeof record.code === "string") parts.push(record.code);
  if (typeof record.message === "string") parts.push(record.message);
  if (record.meta && typeof record.meta === "object") {
    const meta = record.meta as { code?: unknown; message?: unknown };
    if (typeof meta.code === "string") parts.push(meta.code);
    if (typeof meta.message === "string") parts.push(meta.message);
  }
  if (record.cause) parts.push(errorText(record.cause, depth + 1));
  return parts.join(" ");
}

export function isLockTimeout(error: unknown): boolean {
  const text = errorText(error);
  return text.includes("55P03") || /lock timeout/i.test(text);
}

export function isStatementTimeout(error: unknown): boolean {
  const text = errorText(error);
  return text.includes("57014") || /statement timeout/i.test(text);
}

export function isTransientDbError(error: unknown): boolean {
  if (isStatementTimeout(error)) return false;
  if (isLockTimeout(error)) return true;
  return /40001|40P01|08006|08003|08001|57P01|ECONNRESET|ECONNREFUSED|Connection terminated|timeout exceeded when trying to connect|sorry, too many clients/i.test(
    errorText(error),
  );
}

export async function withDbRetry<T>(run: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!isTransientDbError(error) || attempt === ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
  throw last;
}

const RESPLIT_LIMIT_MS = 60 * 60 * 1000;

function isSyncBusy(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 4) return false;
  const record = error as { name?: unknown; cause?: unknown };
  if (record.name === "SyncBusy") return true;
  return isSyncBusy(record.cause, depth + 1);
}

/** A fresh SipOut lease waits. Other errors stop. A dead pool gets a few tries. */
export function resplitShouldWait(
  error: unknown,
  elapsedMs: number,
  transientTries: number,
): boolean {
  if (isSyncBusy(error)) return elapsedMs < RESPLIT_LIMIT_MS;
  if (isTransientDbError(error)) return transientTries < ATTEMPTS;
  return false;
}
