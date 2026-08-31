import type { StorageSnapshot } from "@/modules/storage/service";

export async function fetchStorageSnapshot(): Promise<
  { ok: true; data: StorageSnapshot } | { ok: false; message: string }
> {
  const res = await fetch("/api/storage", { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return { ok: false, message: body?.error ?? "Не удалось загрузить хранение" };
  }
  return { ok: true, data: (await res.json()) as StorageSnapshot };
}

export async function postStoragePurge(
  month: string,
): Promise<
  | { ok: true }
  | { ok: false; message: string; conflict?: boolean; status: number }
> {
  const res = await fetch("/api/storage/purge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ month }),
  });
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    reason?: string;
  } | null;
  if (!res.ok) {
    return {
      ok: false,
      message: body?.error ?? body?.reason ?? "Не удалось начать удаление",
      conflict: res.status === 409,
      status: res.status,
    };
  }
  return { ok: true };
}
