import type { DetailSnapshot } from "@/modules/detail/service";

export async function fetchDetailSnapshot(
  month: string,
): Promise<{ ok: true; data: DetailSnapshot } | { ok: false; message: string }> {
  const qs = new URLSearchParams({ month });
  const res = await fetch(`/api/detail?${qs}`, { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return {
      ok: false,
      message: body?.error ?? "Не удалось загрузить детализацию",
    };
  }
  return { ok: true, data: (await res.json()) as DetailSnapshot };
}
