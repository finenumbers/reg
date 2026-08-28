import { mkdirSync } from "node:fs";
import path from "node:path";

export const POISON_FILENAME = ".poison.json";

export function cdrInboxRoot(cwd: string = process.cwd()): string {
  const fromEnv = process.env.CDR_INBOX_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(cwd, "data", "cdr-inbox");
}

export function ensureCdrInbox(cwd?: string): string {
  const root = cdrInboxRoot(cwd);
  mkdirSync(root, { recursive: true });
  return root;
}

export function poisonStorePath(cwd?: string): string {
  return path.join(cdrInboxRoot(cwd), POISON_FILENAME);
}
