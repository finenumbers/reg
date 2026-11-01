/**
 * Catalog XLSX download gate. A restored completed job is marked before
 * React paints, so opening the section does not save the file again.
 */

export type ExportJobDownloadState = {
  id: string;
  status: string;
};

export function noteRestoredExportJob(
  job: ExportJobDownloadState | null,
  downloadedFor: { current: string | null },
  skipToast: { current: string | null },
): void {
  if (!job || job.status === "running") return;
  skipToast.current = `${job.id}:${job.status}`;
  if (job.status === "completed") downloadedFor.current = job.id;
}

/** True once per completed id. The caller saves the file only on true. */
export function takeAutoDownload(
  job: ExportJobDownloadState | null,
  downloadedFor: { current: string | null },
): boolean {
  if (!job || job.status !== "completed") return false;
  if (downloadedFor.current === job.id) return false;
  downloadedFor.current = job.id;
  return true;
}
