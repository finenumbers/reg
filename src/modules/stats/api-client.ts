import type { StatsSnapshot } from "@/modules/stats/service";

export async function fetchStatsSnapshot(
  month: string,
): Promise<{ ok: true; data: StatsSnapshot } | { ok: false; message: string }> {
  const qs = new URLSearchParams({ month });
  const res = await fetch(`/api/stats?${qs}`, { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return {
      ok: false,
      message: body?.error ?? "Не удалось загрузить статистику",
    };
  }
  return { ok: true, data: (await res.json()) as StatsSnapshot };
}
