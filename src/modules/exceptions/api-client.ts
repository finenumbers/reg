/**
 * Browser fetch helpers for digit ABC exceptions.
 */

export type DialExceptionItem = { abc: string };

export type FetchExceptionsResult =
  { ok: true; items: DialExceptionItem[] } | { ok: false; message: string };

export type ExceptionWriteResult = { ok: true } | { ok: false; error: string };

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

export async function fetchExceptions(): Promise<FetchExceptionsResult> {
  const res = await fetch("/api/exceptions", { method: "GET", cache: "no-store" });
  const body = await readJson(res);
  if (!res.ok) {
    return { ok: false, message: errorMessage(body, "Не удалось загрузить исключения") };
  }
  const items =
    body && typeof body === "object" && "items" in body
      ? (body as { items?: unknown }).items
      : null;
  if (!Array.isArray(items)) {
    return { ok: false, message: "Не удалось загрузить исключения" };
  }
  return {
    ok: true,
    items: items.filter(
      (item): item is DialExceptionItem =>
        !!item &&
        typeof item === "object" &&
        "abc" in item &&
        typeof (item as { abc?: unknown }).abc === "string",
    ),
  };
}

export async function addException(abc: string): Promise<ExceptionWriteResult> {
  const res = await fetch("/api/exceptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ abc }),
    cache: "no-store",
  });
  const body = await readJson(res);
  if (!res.ok) {
    return { ok: false, error: errorMessage(body, "Не удалось добавить ABC") };
  }
  return { ok: true };
}

export async function deleteException(abc: string): Promise<ExceptionWriteResult> {
  const res = await fetch(`/api/exceptions/${encodeURIComponent(abc)}`, {
    method: "DELETE",
    cache: "no-store",
  });
  const body = await readJson(res);
  if (!res.ok) {
    return { ok: false, error: errorMessage(body, "Не удалось удалить ABC") };
  }
  return { ok: true };
}
