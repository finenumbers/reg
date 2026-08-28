import { mkdirSync } from "node:fs";
import path from "node:path";

export function monthExportDataRoot(cwd: string = process.cwd()): string {
  const fromEnv = process.env.TRAFFIC_EXPORT_DATA_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(cwd, "data", "traffic-export");
}

export function monthExportJobDir(jobId: string, cwd?: string): string {
  return path.join(monthExportDataRoot(cwd), jobId);
}

export function monthExportJsonlPath(jobId: string, cwd?: string): string {
  return path.join(monthExportJobDir(jobId, cwd), "rows.jsonl");
}

export function monthExportOutputPath(jobId: string, cwd?: string): string {
  return path.join(monthExportJobDir(jobId, cwd), "output.xlsx");
}

export function ensureMonthExportRoot(cwd?: string): string {
  const root = monthExportDataRoot(cwd);
  mkdirSync(root, { recursive: true });
  return root;
}

export function ensureMonthExportJobDir(jobId: string, cwd?: string): string {
  const dir = monthExportJobDir(jobId, cwd);
  mkdirSync(dir, { recursive: true });
  return dir;
}
