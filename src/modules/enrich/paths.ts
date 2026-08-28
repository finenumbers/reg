import { mkdirSync } from "node:fs";
import path from "node:path";

export function enrichDataRoot(cwd: string = process.cwd()): string {
  const fromEnv = process.env.ENRICH_DATA_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(cwd, "data", "enrich");
}

export function enrichJobDir(jobId: string, cwd?: string): string {
  return path.join(enrichDataRoot(cwd), jobId);
}

export function enrichSourcePath(jobId: string, cwd?: string): string {
  return path.join(enrichJobDir(jobId, cwd), "source.csv");
}

export function enrichJsonlPath(jobId: string, cwd?: string): string {
  return path.join(enrichJobDir(jobId, cwd), "rows.jsonl");
}

export function enrichOutputPath(jobId: string, cwd?: string): string {
  return path.join(enrichJobDir(jobId, cwd), "output.xlsx");
}

export function ensureJobDir(jobId: string, cwd?: string): string {
  const dir = enrichJobDir(jobId, cwd);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function enrichedDownloadName(sourceFilename: string): string {
  const base = sourceFilename.trim() || "cdr";
  const withoutExt = base.replace(/\.csv$/i, "");
  const safe = withoutExt.replace(/[^\w.\-]+/g, "_") || "cdr";
  return `${safe}-enriched.xlsx`;
}
