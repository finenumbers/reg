import { mkdirSync } from "node:fs";
import path from "node:path";

export const SMG_POISON_FILENAME = ".poison.json";

export function smgInboxRoot(cwd: string = process.cwd()): string {
  const fromEnv = process.env.SMG_CDR_INBOX_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(cwd, "data", "smg-cdr-inbox");
}

export function ensureSmgInbox(cwd?: string): string {
  const root = smgInboxRoot(cwd);
  mkdirSync(root, { recursive: true });
  return root;
}

export function smgPoisonStorePath(cwd?: string): string {
  return path.join(smgInboxRoot(cwd), SMG_POISON_FILENAME);
}
