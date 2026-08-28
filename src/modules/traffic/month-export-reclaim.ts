import { rm } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { logger } from "@/lib/logger";
import { MONTH_EXPORT_ARTIFACT_TTL_MS } from "@/modules/traffic/month-export-types";
import {
  ensureMonthExportRoot,
  monthExportDataRoot,
  monthExportJobDir,
} from "@/modules/traffic/month-export-paths";

export async function removeMonthExportJobDir(jobId: string): Promise<void> {
  await rm(monthExportJobDir(jobId), { recursive: true, force: true });
}

export async function pruneMonthExportArtifacts(
  now: Date = new Date(),
): Promise<{ removed: number }> {
  const root = monthExportDataRoot();
  try {
    ensureMonthExportRoot();
  } catch {
    return { removed: 0 };
  }
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return { removed: 0 };
  }
  const cutoff = now.getTime() - MONTH_EXPORT_ARTIFACT_TTL_MS;
  let removed = 0;
  for (const name of entries) {
    const dir = path.join(root, name);
    try {
      const info = await stat(dir);
      if (info.mtimeMs > cutoff) continue;
      await rm(dir, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      logger.warn("traffic.export.artifact_prune_failed", {
        jobId: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { removed };
}
