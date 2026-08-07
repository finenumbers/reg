/**
 * Trigger browser download from an authenticated XLSX API response.
 */

export type DownloadXlsxResult =
  | { ok: true; filename: string }
  | { ok: false; status: number; message: string };

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
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return { ok: true, filename };
}
