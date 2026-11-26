/**
 * Browser client for ephemeral cost-estimate XLSX.
 */

import { triggerBlobDownload } from "@/lib/download-xlsx";

export type CostEstimateClientResult =
  | { ok: true; filename: string; pstnSnapshotEmpty: boolean }
  | { ok: false; status: number; error: string; details: string[] };

function filenameFromDisposition(header: string | null): string {
  if (!header) return "Расчет затрат.xlsx";
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1]);
    } catch {
      /* ignore */
    }
  }
  return (
    /filename="([^"]+)"/i.exec(header)?.[1] ?? "Расчет затрат.xlsx"
  );
}

export async function runCostEstimateUpload(
  file: File,
): Promise<CostEstimateClientResult> {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch("/api/cost-estimate", {
    method: "POST",
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    let error = "Не удалось рассчитать затраты";
    let details: string[] = [];
    try {
      const json = (await res.json()) as {
        error?: string;
        details?: unknown;
      };
      if (typeof json.error === "string" && json.error.trim()) {
        error = json.error.trim();
      }
      if (Array.isArray(json.details)) {
        details = json.details
          .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
          .map((d) => d.trim());
      }
    } catch {
      /* ignore */
    }
    if (details.length === 0) details = [error];
    return { ok: false, status: res.status, error, details };
  }

  const blob = await res.blob();
  const filename = filenameFromDisposition(
    res.headers.get("Content-Disposition"),
  );
  triggerBlobDownload(blob, filename);
  return {
    ok: true,
    filename,
    pstnSnapshotEmpty: res.headers.get("X-Cost-Estimate-Pstn-Empty") === "1",
  };
}
