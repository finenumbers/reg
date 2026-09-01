const TRANSIENT_CODES = new Set(["P2028", "P1017", "25P02", "08P01"]);

const TRANSIENT_MESSAGE =
  /transaction has been aborted|connection terminated|econnreset|econnrefused|epipe|too many clients|can't reach database server|timed out fetching a new connection|unable to start a transaction|lost connection/i;

const INVOCATION_LINE = /^Invalid `prisma\.[^`]+` invocation:?$/i;

export function isTransientPrismaError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return TRANSIENT_MESSAGE.test(String(error));
  }
  const typed = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown };
  };
  if (typeof typed.code === "string" && TRANSIENT_CODES.has(typed.code)) {
    return true;
  }
  const metaCode =
    typed.meta && typeof typed.meta.code === "string" ? typed.meta.code : "";
  if (metaCode && TRANSIENT_CODES.has(metaCode)) return true;
  const message = typeof typed.message === "string" ? typed.message : String(error);
  return TRANSIENT_MESSAGE.test(message);
}

export function compactPrismaError(error: unknown, maxChars = 280): string {
  const code =
    typeof error === "object" &&
    error &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error &&
          "message" in error &&
          typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : String(error);
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const diagnostic =
    lines.find((line) => !INVOCATION_LINE.test(line)) ?? lines[0] ?? raw;
  const body = diagnostic.slice(0, maxChars);
  if (code && !body.includes(code)) return `${code}: ${body}`;
  return body;
}

export function prismaErrorFields(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return { error: String(error) };
  }
  const typed = error as {
    code?: unknown;
    meta?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  return {
    error: typeof typed.message === "string" ? typed.message : String(error),
    code: typed.code ?? null,
    meta: typed.meta ?? null,
    cause:
      typed.cause instanceof Error
        ? typed.cause.message
        : (typed.cause ?? null),
  };
}

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; delayMs?: number },
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const delayMs = opts?.delayMs ?? 300;
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (i + 1 >= attempts || !isTransientPrismaError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw last;
}
