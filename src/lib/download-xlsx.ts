/**
 * Trigger browser download from an authenticated XLSX API response.
 */

export type DownloadXlsxResult =
  | { ok: true; filename: string; noticeCount?: number }
  | { ok: false; status: number; message: string };

function readNoticeCount(raw: string | null): number | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 0) return undefined;
  return count;
}

function filenameFromContentDisposition(
  header: string | null,
  fallback: string,
): string {
  if (!header) return fallback;
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1]);
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  if (plain?.[1]) return plain[1];
  return fallback;
}

export async function downloadXlsxFromUrl(
  url: string,
  fallbackFilename: string,
  noticeHeader?: string,
): Promise<DownloadXlsxResult> {
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) {
    let message = "Не удалось скачать файл";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error?.trim()) message = body.error.trim();
    } catch {
      /* ignore */
    }
    return { ok: false, status: res.status, message };
  }

  const blob = await res.blob();
  const filename = filenameFromContentDisposition(
    res.headers.get("Content-Disposition"),
    fallbackFilename,
  );
  triggerBlobDownload(blob, filename);
  const noticeCount = readNoticeCount(
    noticeHeader ? res.headers.get(noticeHeader) : null,
  );
  return noticeCount == null ? { ok: true, filename } : { ok: true, filename, noticeCount };
}

/** Keep the blob alive long enough for the browser to start saving it. */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}
